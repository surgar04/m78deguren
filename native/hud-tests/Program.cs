using EndfieldChargePlus.Customization;
using ZhenjingMonitor.Hud;

// 只验证实际迁移的纯数据引擎；不请求驱动、ETW、网络、注册表写入或证书信任。
int assertions=0;
void Check(bool condition,string message){assertions++;if(!condition)throw new InvalidOperationException(message);}
var vars=new Dictionary<string,object?> { ["memory.used_bytes"]=8589934592d,["cpu.usage"]=36.25,["cpu.frequency_ghz"]=4.2 };
Check(CustomHudSettings.CreateDefaultProfiles().Count==12,"上游内置方案遗漏");
Check(TemplateEngine.Render("{memory.used_bytes|gb:1}",vars)=="8.0","原始 GB 模板格式不兼容");
Check(TemplateEngine.Render("{missing.value}",vars)=="--","不可用变量被伪造");
Check(ExpressionEngine.TryEvaluate("round(cpu.usage,1)",vars,out var value,out _)&&Convert.ToDouble(value)==36.3,"安全表达式未按上游规则求值");
Check(!ExpressionEngine.TryEvaluate("System.IO.File.Delete('x')",vars,out _,out _),"表达式越过沙箱");
Check(!ExpressionEngine.TryEvaluate(new string('(',100)+"1"+new string(')',100),vars,out _,out _),"深递归模板未被拒绝");
Check(TemplateEngine.Render("{cpu.usage|F999999999}",vars)=="--","数值格式可无限分配内存");
var profile=CustomHudSettings.CreateDefaultProfiles().Single(p=>p.BuiltInKey=="system.cpu");
var rendered=HudProfileRenderer.Render(profile,vars);
Check(rendered.PrimaryText=="4.20"&&Math.Abs(rendered.Progress-.3625)<.00001,"上游布局字段或圆环计算不一致");
var condition=profile with {ColorRules=[new(){Variable="cpu.usage",Operator=">=",Value=30,Color="#112233"}]};
Check(HudProfileRenderer.Render(condition,vars).AccentColor=="#112233","条件色规则未生效");
var frames=new FrameEventWindow();Check(frames.Read(1000) is null,"没有真实事件时生成 FPS");
frames.Add(0,1000);frames.Add(.01,1010);frames.Add(.02,1020);
Check(Math.Abs((frames.Read(1020)??0)-100)<.001,"实际时间戳 FPS 统计错误");
using(var content=new ByteArrayContent(new byte[1048577])){
    bool rejected=false;try{await HudHttp.ReadLimitedAsync(content,CancellationToken.None);}catch(FormatException){rejected=true;}
    Check(rejected,"HTTP 超大响应未被拒绝");
}
using(var content=new StringContent("{\"value\":123}"))Check((await HudHttp.ReadLimitedAsync(content,CancellationToken.None)).Contains("123"),"HTTP 有界读取损坏正文");
Console.WriteLine($"HUD 迁移核心：{assertions} 项真实逻辑断言通过。");
var trigger=new HudTriggerRule {Id="cpu-limit",Variable="cpu.usage",Value=30,CooldownSeconds=10};
var evaluator=new HudTriggerEvaluator();
Check(evaluator.Evaluate([trigger],vars,0).Count==0,"首次读取不应误触发变化");
var matches=evaluator.Evaluate([trigger],vars,1000);
Check(matches.Count==1,"达到阈值时未触发");evaluator.Presented(matches,1000);
Check(evaluator.Evaluate([trigger],vars,2000).Count==0,"触发冷却没有生效");
Check(evaluator.Evaluate([trigger],vars,11000).Count==1,"冷却结束后不能再次触发");
Console.WriteLine($"HUD 条件触发测试通过；累计 {assertions} 项断言。");
