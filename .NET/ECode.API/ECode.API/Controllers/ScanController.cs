using ECode.API.Data;
using Microsoft.AspNetCore.Mvc;
using Npgsql;

namespace ECode.API.Controllers;

[ApiController]
[Route("api/[controller]")]
public class ScanController : ControllerBase
{
    private readonly Database _db;

    public ScanController(Database db)
    {
        _db = db;
    }

    [HttpPost]
    public async Task<IActionResult> SaveScan([FromBody] ScanRequest req)
    {
        await using var conn = _db.CreateConnection();
        await conn.OpenAsync();

        var qrCmd = new NpgsqlCommand(
            "SELECT id FROM qr_codes WHERE uid = @uid AND is_deleted = false LIMIT 1", conn);
        qrCmd.Parameters.AddWithValue("uid", req.RawContent);
        var qrId = await qrCmd.ExecuteScalarAsync();

        var cmd = new NpgsqlCommand(@"
            INSERT INTO qr_scan_events (qr_code_id, scanned_by_user_id, scanned_uid, raw_content, scan_source)
            VALUES (@qrId, @userId, @scannedUid, @raw, 'camera')", conn);

        cmd.Parameters.AddWithValue("qrId", qrId ?? (object)DBNull.Value);
        cmd.Parameters.AddWithValue("userId", (object?)req.ScannedByUserId ?? DBNull.Value);
        cmd.Parameters.AddWithValue("scannedUid", (object?)req.RawContent ?? DBNull.Value);
        cmd.Parameters.AddWithValue("raw", req.RawContent);

        await cmd.ExecuteNonQueryAsync();
        return Ok(new { message = "Scan saved" });
    }

    [HttpGet("count/{userId}")]
    public async Task<IActionResult> GetCount(long userId)
    {
        await using var conn = _db.CreateConnection();
        await conn.OpenAsync();

        var cmd = new NpgsqlCommand(
            "SELECT COUNT(*) FROM qr_scan_events WHERE scanned_by_user_id = @userId", conn);
        cmd.Parameters.AddWithValue("userId", userId);

        var count = (long)(await cmd.ExecuteScalarAsync() ?? 0L);
        return Ok(new { count });
    }
}

public record ScanRequest(string RawContent, long? ScannedByUserId);
