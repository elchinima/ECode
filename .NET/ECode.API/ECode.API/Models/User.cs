namespace ECode.API.Models;

public class User
{
    public long Id { get; set; }
    public string FullName { get; set; } = string.Empty;
    public string ContactType { get; set; } = string.Empty;
    public string ContactValue { get; set; } = string.Empty;
    public string PasswordHash { get; set; } = string.Empty;
    public DateTime CreatedAt { get; set; }
}