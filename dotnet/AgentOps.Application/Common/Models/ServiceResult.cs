namespace AgentOps.Application.Common.Models;

public class ServiceResult<T>
{
    public bool Succeeded { get; private set; }
    public T? Data { get; private set; }
    public string? ErrorMessage { get; private set; }
    public List<string> ValidationErrors { get; private set; } = new();

    public static ServiceResult<T> Success(T data) => new() { Succeeded = true, Data = data };
    public static ServiceResult<T> Failure(string error) => new() { Succeeded = false, ErrorMessage = error };
    public static ServiceResult<T> ValidationFailure(List<string> errors) => new()
    {
        Succeeded = false,
        ErrorMessage = "Validation failed.",
        ValidationErrors = errors
    };
}
