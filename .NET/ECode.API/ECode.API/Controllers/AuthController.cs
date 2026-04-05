using ECode.API.Data;
using ECode.API.Models;
using Microsoft.AspNetCore.Mvc;
using Npgsql;

namespace ECode.API.Controllers;

[ApiController]
[Route("api/[controller]")]
public class AuthController : ControllerBase
{
    private readonly Database _db;
    private readonly ILogger<AuthController> _logger;

    public AuthController(Database db, ILogger<AuthController> logger)
    {
        _db = db;
        _logger = logger;
    }

    [HttpPost("register")]
    public async Task<IActionResult> Register([FromBody] RegisterRequest req)
    {
        try
        {
            if (!TryNormalizeContact(req.ContactType, req.ContactValue, out var normalizedContact))
                return BadRequest(new { message = "Invalid contact value" });

            await using var conn = _db.CreateConnection();
            await conn.OpenAsync();

            var checkCmd = new NpgsqlCommand(
                """
                SELECT COUNT(*)
                FROM users
                WHERE contact_type = @ct
                  AND (
                        CASE
                            WHEN contact_type = 'email' THEN lower(trim(contact_value))
                            WHEN contact_type = 'phone' THEN regexp_replace(trim(contact_value), '[\s\-\(\)]', '', 'g')
                            ELSE trim(contact_value)
                        END
                      ) = @cv
                """, conn);
            checkCmd.Parameters.AddWithValue("ct", req.ContactType);
            checkCmd.Parameters.AddWithValue("cv", normalizedContact);
            var exists = (long)(await checkCmd.ExecuteScalarAsync())! > 0;
            if (exists) return Conflict(new { message = "User already exists" });

            var cmd = new NpgsqlCommand(
                "INSERT INTO users (full_name, contact_type, contact_value, password_hash) VALUES (@name, @ct, @cv, @ph) RETURNING id", conn);
            cmd.Parameters.AddWithValue("name", req.FullName.Trim());
            cmd.Parameters.AddWithValue("ct", req.ContactType);
            cmd.Parameters.AddWithValue("cv", normalizedContact);
            cmd.Parameters.AddWithValue("ph", req.Password);

            var id = (long)(await cmd.ExecuteScalarAsync())!;
            return Ok(new { id, message = "Registered successfully" });
        }
        catch (PostgresException ex) when (ex.SqlState == PostgresErrorCodes.UniqueViolation)
        {
            return Conflict(new { message = "User already exists" });
        }
        catch (PostgresException ex)
        {
            _logger.LogError(ex, "Database error in register");
            return StatusCode(500, new { message = "Server error. Please try again later." });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Unexpected error in register");
            return StatusCode(500, new { message = "Server error. Please try again later." });
        }
    }

    [HttpPost("login")]
    public async Task<IActionResult> Login([FromBody] LoginRequest req)
    {
        try
        {
            if (!TryNormalizeContact(req.ContactType, req.ContactValue, out var normalizedContact))
                return BadRequest(new { message = "Invalid contact value" });

            await using var conn = _db.CreateConnection();
            await conn.OpenAsync();

            var cmd = new NpgsqlCommand(
                """
                SELECT id, full_name
                FROM users
                WHERE contact_type = @ct
                  AND (
                        CASE
                            WHEN contact_type = 'email' THEN lower(trim(contact_value))
                            WHEN contact_type = 'phone' THEN regexp_replace(trim(contact_value), '[\s\-\(\)]', '', 'g')
                            ELSE trim(contact_value)
                        END
                      ) = @cv
                  AND password_hash = @ph
                """, conn);
            cmd.Parameters.AddWithValue("ct", req.ContactType);
            cmd.Parameters.AddWithValue("cv", normalizedContact);
            cmd.Parameters.AddWithValue("ph", req.Password);

            await using var reader = await cmd.ExecuteReaderAsync();
            if (!await reader.ReadAsync()) return Unauthorized(new { message = "Invalid credentials" });

            return Ok(new { id = reader.GetInt64(0), fullName = reader.GetString(1) });
        }
        catch (PostgresException ex)
        {
            _logger.LogError(ex, "Database error in login");
            return StatusCode(500, new { message = "Server error. Please try again later." });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Unexpected error in login");
            return StatusCode(500, new { message = "Server error. Please try again later." });
        }
    }

    private static bool TryNormalizeContact(string contactType, string contactValue, out string normalized)
    {
        normalized = string.Empty;
        if (string.IsNullOrWhiteSpace(contactType) || string.IsNullOrWhiteSpace(contactValue))
            return false;

        var type = contactType.Trim().ToLowerInvariant();
        var value = contactValue.Trim();

        if (type == "email")
        {
            normalized = value.ToLowerInvariant();
            return true;
        }

        if (type == "phone")
        {
            var chars = value.Where(ch => char.IsDigit(ch) || ch == '+').ToArray();
            normalized = new string(chars);
            return normalized.Length >= 7;
        }

        return false;
    }
}

public record RegisterRequest(string FullName, string ContactType, string ContactValue, string Password);
public record LoginRequest(string ContactType, string ContactValue, string Password);
