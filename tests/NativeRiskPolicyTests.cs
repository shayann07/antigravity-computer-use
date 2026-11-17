using System;using System.Collections.Generic;using System.Reflection;
// Reflection calls the real compiled policy only. Never invoke the host entry
// point, create windows, register hooks, inspect target apps or dispatch input.
class NativeRiskPolicyTests {
 static int Main(string[] args){try{
  var assembly=Assembly.LoadFrom(args[0]);var method=assembly.GetType("Axon.ControlFence",true).GetMethod("Sensitive",BindingFlags.NonPublic|BindingFlags.Static);
  Check(method,"click","",true);Check(method,"drag","",true);Check(method,"click","   ",true);
  Check(method,"click","Open settings Button",false);Check(method,"move","",false);
  Check(method,"click","Delete file Button",true);Check(method,"click","de\u200Dlete file Button",true);Check(method,"click","\u200D",true);
  // Access tiers: a click-only app takes a plain left click, moves, scrolls and focus, nothing else.
  var tier=assembly.GetType("Axon.ControlFence",true).GetMethod("ClickTierAllows",BindingFlags.NonPublic|BindingFlags.Static);
  Tier(tier,"click",new Dictionary<string,object>(),true);Tier(tier,"click",new Dictionary<string,object>{{"button","left"}},true);
  Tier(tier,"move",new Dictionary<string,object>(),true);Tier(tier,"scroll",new Dictionary<string,object>(),true);Tier(tier,"focus",new Dictionary<string,object>(),true);
  Tier(tier,"click",new Dictionary<string,object>{{"button","right"}},false);Tier(tier,"click",new Dictionary<string,object>{{"modifiers",new object[]{"ctrl"}}},false);
  Tier(tier,"click",new Dictionary<string,object>{{"modifiers","shift"}},false);
  foreach(string blocked in new string[]{"type","key","paste","paste_files","set_value","drag","file_dialog","open","close_window","clipboard"})Tier(tier,blocked,new Dictionary<string,object>(),false);
  var keys=assembly.GetType("Axon.ControlFence",true).GetMethod("ClickTierKeys",BindingFlags.NonPublic|BindingFlags.Static);
  string packed=Convert.ToBase64String(System.Text.Encoding.UTF8.GetBytes("1:2:a.exe"+(char)10+"3:4:b.exe"));
  var parsed=(HashSet<string>)keys.Invoke(null,new object[]{new string[]{"active","t","1","","2",packed}});
  if(parsed.Count!=2||!parsed.Contains("1:2:a.exe")||!parsed.Contains("3:4:b.exe"))throw new Exception("Click-tier grant list was not parsed");
  // A guard file written by an older build has five fields and no click-only apps.
  if(((HashSet<string>)keys.Invoke(null,new object[]{new string[]{"active","t","1","","2"}})).Count!=0)throw new Exception("Legacy guard state must have no click-only apps");
  // The single-controller lock: one session-local name per user SID, with no path in it, so every install agrees.
  var lease=assembly.GetType("Axon.InputLease",true);
  string leaseName=(string)lease.GetMethod("Name",BindingFlags.NonPublic|BindingFlags.Static).Invoke(null,new object[]{"S-1-5-21-1-2-3-1001"});
  if(!System.Text.RegularExpressions.Regex.IsMatch(leaseName,"^Local.AGCU[.]Input[.]v1[.][0-9a-f]{64}$")||leaseName[5]!=(char)92)throw new Exception("Unexpected input lease name: "+leaseName);
  if(leaseName!=(string)lease.GetMethod("Name",BindingFlags.NonPublic|BindingFlags.Static).Invoke(null,new object[]{"S-1-5-21-1-2-3-1001"}))throw new Exception("Input lease name is not stable");
  if(leaseName==(string)lease.GetMethod("Name",BindingFlags.NonPublic|BindingFlags.Static).Invoke(null,new object[]{"S-1-5-21-1-2-3-1002"}))throw new Exception("Input lease name must differ per user");
  string heldText=(string)lease.GetField("HeldMessage",BindingFlags.NonPublic|BindingFlags.Static).GetValue(null);
  if(heldText!="Another copy of Computer Use is controlling this PC; multiple copies are not supported yet.")throw new Exception("Held message changed");
  Console.WriteLine("PASS native ambiguous-target and risk-only Unicode classification; no input APIs used");return 0;
 }catch(Exception error){Console.Error.WriteLine(error);return 1;}}
 static void Tier(MethodInfo method,string op,Dictionary<string,object> args,bool expected){
  bool actual=(bool)method.Invoke(null,new object[]{op,args});
  if(actual!=expected)throw new Exception("Click-tier mismatch: operation="+op+" expected_allowed="+expected+" actual="+actual);
 }
 static void Check(MethodInfo method,string op,string label,bool expected){
  bool actual=(bool)method.Invoke(null,new object[]{op,new Dictionary<string,object>{{"__risk","routine"}},label});
  if(actual!=expected)throw new Exception("Native classifier mismatch: operation="+op+" expected_sensitive="+expected+" actual="+actual);
 }
}
