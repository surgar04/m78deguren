using System.Text.Json;
using System.Text.Json.Serialization;

namespace Zhenjing.Plugins;

/// <summary>WIT 只提供有界能力调用；SDK 不持有原生句柄或权限凭据。</summary>
public sealed class PluginClient(Func<string, string> call)
{
    public JsonElement Request(string method, JsonElement parameters)
    {
        string request = JsonSerializer.Serialize(new CallEnvelope(method, parameters), PluginJsonContext.Default.CallEnvelope);
        if (request.Length > 1024 * 1024) throw new ArgumentException("插件请求超过上限");
        using JsonDocument document = JsonDocument.Parse(call(request));
        return document.RootElement.Clone();
    }
    /// <summary>显式构造参数，NativeAOT 下不依赖反射或动态类型。</summary>
    private static JsonElement Parameters(string key, long? value = null)
    {
        using var stream = new MemoryStream();
        using (var writer = new Utf8JsonWriter(stream))
        {
            writer.WriteStartObject(); writer.WriteString("key", key);
            if (value.HasValue) writer.WriteNumber("value", value.Value);
            writer.WriteEndObject();
        }
        using JsonDocument document = JsonDocument.Parse(stream.ToArray());
        return document.RootElement.Clone();
    }
    public JsonElement Read(string key) => Request("storage.get", Parameters(key));
    public void Write(string key, long value) => Request("storage.put", Parameters(key, value));
    public void Delete(string key) => Request("storage.delete", Parameters(key));
    public static string View(ViewNode node) => JsonSerializer.Serialize(node, PluginJsonContext.Default.ViewNode);
}
public sealed record ViewNode(string Type, string? Text = null, string? Value = null, string? Command = null, ViewNode[]? Children = null, string? Mode = null);
internal sealed record CallEnvelope(string Method, JsonElement Params);

// 编译期生成协议元数据，不启用全局反射回退。
[JsonSourceGenerationOptions(PropertyNamingPolicy = JsonKnownNamingPolicy.CamelCase, DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull)]
[JsonSerializable(typeof(ViewNode))]
[JsonSerializable(typeof(CallEnvelope))]
internal partial class PluginJsonContext : JsonSerializerContext { }
