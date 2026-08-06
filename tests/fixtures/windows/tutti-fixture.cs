using System;
using System.IO;

public static class Program
{
    public static int Main(string[] args)
    {
        string logPath = Environment.GetEnvironmentVariable("GROUP_CHAT_TUTTI_FIXTURE_LOG");
        if (!String.IsNullOrWhiteSpace(logPath))
        {
            File.AppendAllText(logPath, String.Join("\u001f", args) + Environment.NewLine);
        }

        if (Array.IndexOf(args, "list") >= 0)
        {
            string executablePath = System.Reflection.Assembly.GetExecutingAssembly().Location.Replace("\\", "\\\\");
            Console.WriteLine("{\"schemaVersion\":1,\"defaultAgentTargetId\":\"fixture:codex\",\"agents\":[{\"id\":\"fixture:codex\",\"name\":\"Windows Fixture\",\"provider\":\"codex\",\"executablePath\":\"" + executablePath + "\",\"availability\":{\"status\":\"available\",\"reasonCode\":\"ready\",\"detail\":\"\"}}]}");
            return 0;
        }

        if (Array.IndexOf(args, "composer-options") >= 0)
        {
            Console.WriteLine("{\"schemaVersion\":2,\"agentTargetId\":\"fixture:codex\",\"providerId\":\"codex\",\"effectiveSettings\":{\"model\":\"default\"},\"modelConfig\":{\"configurable\":true,\"currentValue\":\"default\",\"defaultValue\":\"default\",\"options\":[{\"id\":\"default\",\"value\":\"default\",\"label\":\"Default\"}]},\"permissionConfig\":{\"configurable\":false,\"defaultValue\":\"full-access\",\"modes\":[]},\"reasoningConfig\":{\"configurable\":false,\"currentValue\":\"\",\"defaultValue\":\"\",\"options\":[]},\"speedConfig\":{\"configurable\":false,\"currentValue\":\"\",\"defaultValue\":\"\",\"options\":[]}}");
            return 0;
        }

        if (!String.IsNullOrWhiteSpace(logPath))
        {
            File.AppendAllText(logPath, "RUN\u001f" + String.Join("\u001f", args) + Environment.NewLine);
        }
        Console.In.ReadToEnd();
        Console.WriteLine("{\"type\":\"text_delta\",\"text\":\"windows-agent-ok\"}");
        return 0;
    }
}
