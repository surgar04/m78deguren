using System.Text.Json;
using PluginWorld.wit.Imports.zhenjing.plugin.v1_0_0;
using Zhenjing.Plugins;

namespace PluginWorld.wit.Exports.zhenjing.plugin.v1_0_0;

/// <summary>插件入口由 WIT 生成，不能把此程序集直接加载到臻境主进程。</summary>
public class LifecycleExportsImpl : ILifecycleExports
{
    public static string Invoke(string command, string input)
    {
        // 迁移运行在可丢弃的数据副本上；此示例格式保持不变，只确认宿主指定的数据版本。
        if (command == "migrate")
        {
            using var document = JsonDocument.Parse(input);
            uint target = document.RootElement.GetProperty("to").GetUInt32();
            if (target < 1) throw new ArgumentException("无效迁移版本");
            return "{\"dataVersion\":" + target.ToString(System.Globalization.CultureInfo.InvariantCulture) + "}";
        }
        // 生成绑定的结果类型会在构建时校验，不能用反射或 dynamic 绕过 ABI。
        var client = new PluginClient(request => ICapabilitiesImports.Call(request));
        JsonElement value = client.Read("counter");
        long count = value.ValueKind == JsonValueKind.Number && value.TryGetInt64(out long current) ? current : 0;
        if (command == "increment") client.Write("counter", checked(count + 1));
        return PluginClient.View(new ViewNode("stack", Children: [
            new("heading", Text: "C# 插件"),
            new("metric", Text: "私有计数", Value: count.ToString()),
            new("button", Text: "增加计数", Command: "increment")
        ]));
    }
}
