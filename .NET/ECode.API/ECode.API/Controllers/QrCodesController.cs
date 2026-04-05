using ECode.API.Data;
using Microsoft.AspNetCore.Mvc;
using Npgsql;

namespace ECode.API.Controllers;

[ApiController]
[Route("api/[controller]")]
public class QrCodesController : ControllerBase
{
    private readonly Database _db;

    public QrCodesController(Database db)
    {
        _db = db;
    }

    [HttpPost]
    public async Task<IActionResult> Create([FromBody] CreateQrRequest req)
    {
        await using var conn = _db.CreateConnection();
        await conn.OpenAsync();

        var catCmd = new NpgsqlCommand(
            "SELECT id FROM categories WHERE name = @name LIMIT 1", conn);
        catCmd.Parameters.AddWithValue("name", req.CategoryName);
        var catId = await catCmd.ExecuteScalarAsync();

        if (catId == null)
        {
            var newCat = new NpgsqlCommand(
                "INSERT INTO categories (name, is_system, created_by_user_id) VALUES (@name, false, @uid) RETURNING id", conn);
            newCat.Parameters.AddWithValue("name", req.CategoryName);
            newCat.Parameters.AddWithValue("uid", req.CreatorUserId);
            catId = await newCat.ExecuteScalarAsync();
        }

        var cmd = new NpgsqlCommand(@"
            INSERT INTO qr_codes (uid, creator_user_id, subject_name, subject_email, subject_phone, category_id, custom_text, payload_text)
            VALUES (@uid, @creator, @name, @email, @phone, @cat, @custom, @payload)
            RETURNING id", conn);

        cmd.Parameters.AddWithValue("uid", req.Uid);
        cmd.Parameters.AddWithValue("creator", req.CreatorUserId);
        cmd.Parameters.AddWithValue("name", (object?)req.SubjectName ?? DBNull.Value);
        cmd.Parameters.AddWithValue("email", (object?)req.SubjectEmail ?? DBNull.Value);
        cmd.Parameters.AddWithValue("phone", (object?)req.SubjectPhone ?? DBNull.Value);
        cmd.Parameters.AddWithValue("cat", (int)catId!);
        cmd.Parameters.AddWithValue("custom", (object?)req.CustomText ?? DBNull.Value);
        cmd.Parameters.AddWithValue("payload", req.PayloadText);

        var id = await cmd.ExecuteScalarAsync();
        return Ok(new { id });
    }

    [HttpGet("user/{userId}")]
    public async Task<IActionResult> GetByUser(long userId)
    {
        await using var conn = _db.CreateConnection();
        await conn.OpenAsync();

        var cmd = new NpgsqlCommand(@"
            SELECT q.uid, q.subject_name, q.custom_text, q.payload_text, q.generated_at, c.name as category
            FROM qr_codes q
            JOIN categories c ON c.id = q.category_id
            WHERE q.creator_user_id = @uid AND q.is_deleted = false
            ORDER BY q.generated_at DESC
            LIMIT 20", conn);
        cmd.Parameters.AddWithValue("uid", userId);

        var result = new List<object>();
        await using var reader = await cmd.ExecuteReaderAsync();
        while (await reader.ReadAsync())
        {
            result.Add(new
            {
                uid = reader.GetString(0),
                name = reader.IsDBNull(1) ? null : reader.GetString(1),
                customText = reader.IsDBNull(2) ? null : reader.GetString(2),
                payloadText = reader.GetString(3),
                generatedAt = reader.GetDateTime(4).ToString("o"),
                category = reader.GetString(5)
            });
        }
        return Ok(result);
    }

    [HttpDelete("{uid}")]
    public async Task<IActionResult> Delete(string uid, [FromQuery] long userId)
    {
        await using var conn = _db.CreateConnection();
        await conn.OpenAsync();

        var cmd = new NpgsqlCommand(
            "UPDATE qr_codes SET is_deleted = true WHERE uid = @uid AND creator_user_id = @userId", conn);
        cmd.Parameters.AddWithValue("uid", uid);
        cmd.Parameters.AddWithValue("userId", userId);
        await cmd.ExecuteNonQueryAsync();
        return Ok(new { message = "Deleted" });
    }

    [HttpDelete("{uid}/permanent")]
    public async Task<IActionResult> DeletePermanent(string uid, [FromQuery] long userId)
    {
        await using var conn = _db.CreateConnection();
        await conn.OpenAsync();

        var cmd = new NpgsqlCommand(
            "DELETE FROM qr_codes WHERE uid = @uid AND creator_user_id = @userId", conn);
        cmd.Parameters.AddWithValue("uid", uid);
        cmd.Parameters.AddWithValue("userId", userId);
        await cmd.ExecuteNonQueryAsync();

        return Ok(new { message = "Deleted permanently" });
    }

    [HttpDelete("category/by-name/permanent")]
    public async Task<IActionResult> DeleteCategoryPermanently([FromQuery] long userId, [FromQuery] string categoryName)
    {
        if (string.IsNullOrWhiteSpace(categoryName))
            return BadRequest(new { message = "Category name is required." });

        await using var conn = _db.CreateConnection();
        await conn.OpenAsync();
        var cmd = new NpgsqlCommand(@"
            WITH target_category AS (
                SELECT id
                FROM categories
                WHERE created_by_user_id = @userId
                  AND is_system = false
                  AND name = @categoryName
                LIMIT 1
            ),
            deleted_qr AS (
                DELETE FROM qr_codes
                WHERE creator_user_id = @userId
                  AND category_id IN (SELECT id FROM target_category)
                RETURNING id
            ),
            deleted_category AS (
                DELETE FROM categories
                WHERE id IN (SELECT id FROM target_category)
                  AND created_by_user_id = @userId
                  AND is_system = false
                RETURNING id
            )
            SELECT
                (SELECT COUNT(*) FROM deleted_qr) AS deleted_qr_count,
                (SELECT COUNT(*) FROM deleted_category) AS deleted_category_count;", conn);

        cmd.Parameters.AddWithValue("userId", userId);
        cmd.Parameters.AddWithValue("categoryName", categoryName.Trim());

        await using var reader = await cmd.ExecuteReaderAsync();
        if (!await reader.ReadAsync())
            return StatusCode(500, new { message = "Deletion result was not returned." });

        var deletedQrCount = reader.GetInt32(0);
        var deletedCategoryCount = reader.GetInt32(1);

        if (deletedCategoryCount == 0)
            return NotFound(new { message = "Custom category not found." });

        return Ok(new { message = "Category and related QR codes were permanently deleted.", deletedQrCount });
    }
}

public record CreateQrRequest(
    string Uid,
    long CreatorUserId,
    string? SubjectName,
    string? SubjectEmail,
    string? SubjectPhone,
    string CategoryName,
    string? CustomText,
    string PayloadText
);
