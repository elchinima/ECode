namespace ECode.API.Models;

public class QrCode
{
    public long Id { get; set; }
    public string Uid { get; set; } = string.Empty;
    public long CreatorUserId { get; set; }
    public string? SubjectName { get; set; }
    public string? SubjectEmail { get; set; }
    public string? SubjectPhone { get; set; }
    public int CategoryId { get; set; }
    public string? CustomText { get; set; }
    public string PayloadText { get; set; } = string.Empty;
    public DateTime GeneratedAt { get; set; }
}