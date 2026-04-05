using ECode.API.Data;
using Npgsql;

namespace ECode.API.Services;

public sealed class ScanEventsCleanupService : BackgroundService
{
    private const int BatchSize = 100;
    private static readonly TimeSpan FollowUpDelay = TimeSpan.FromMinutes(10);
    private readonly Database _db;
    private readonly ILogger<ScanEventsCleanupService> _logger;

    public ScanEventsCleanupService(Database db, ILogger<ScanEventsCleanupService> logger)
    {
        _db = db;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await DelayUntilNextTopOfHour(stoppingToken);
                await RunCleanupCycle(stoppingToken);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to cleanup old scan events.");
            }
        }
    }

    private static async Task DelayUntilNextTopOfHour(CancellationToken ct)
    {
        var now = DateTimeOffset.Now;
        var next = new DateTimeOffset(now.Year, now.Month, now.Day, now.Hour, 0, 0, now.Offset).AddHours(1);
        var delay = next - now;
        if (delay > TimeSpan.Zero)
            await Task.Delay(delay, ct);
    }

    private async Task RunCleanupCycle(CancellationToken ct)
    {
        var deletedNow = await DeleteExpiredBatch(ct);
        if (deletedNow > 0)
            _logger.LogInformation("Scan cleanup at :00 deleted {DeletedCount} records.", deletedNow);

        var remaining = await CountExpired(ct);
        if (remaining <= 0) return;

        _logger.LogInformation("Scan cleanup found {RemainingCount} more expired records. Next batch in 10 minutes.", remaining);
        await Task.Delay(FollowUpDelay, ct);

        var deletedFollowUp = await DeleteExpiredBatch(ct);
        if (deletedFollowUp > 0)
            _logger.LogInformation("Scan cleanup follow-up deleted {DeletedCount} records.", deletedFollowUp);
    }

    private async Task<int> DeleteExpiredBatch(CancellationToken ct)
    {
        await using var conn = _db.CreateConnection();
        await conn.OpenAsync(ct);

        await using var cmd = new NpgsqlCommand(@"
            WITH expired AS (
                SELECT id
                FROM qr_scan_events
                WHERE scanned_at < (NOW() - INTERVAL '24 hours')
                ORDER BY scanned_at
                LIMIT @batchSize
            )
            DELETE FROM qr_scan_events q
            USING expired e
            WHERE q.id = e.id;", conn);
        cmd.Parameters.AddWithValue("batchSize", BatchSize);

        return await cmd.ExecuteNonQueryAsync(ct);
    }

    private async Task<long> CountExpired(CancellationToken ct)
    {
        await using var conn = _db.CreateConnection();
        await conn.OpenAsync(ct);

        await using var cmd = new NpgsqlCommand(@"
            SELECT COUNT(*)
            FROM qr_scan_events
            WHERE scanned_at < (NOW() - INTERVAL '24 hours')", conn);

        return (long)(await cmd.ExecuteScalarAsync(ct) ?? 0L);
    }
}
