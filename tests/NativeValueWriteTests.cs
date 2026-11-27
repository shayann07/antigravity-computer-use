using System;
using System.Collections.Generic;
using System.Reflection;

// Invoke the actual native dispatch policy without opening a window or sending input.
class NativeValueWriteTests {
    static MethodInfo method;
    static void Require(bool value, string message) { if (!value) throw new Exception(message); }
    static string Code(Exception error) {
        var inner = error is TargetInvocationException ? error.InnerException : error;
        var field = inner.GetType().GetField("Code", BindingFlags.Public | BindingFlags.Instance);
        return field == null ? null : (string)field.GetValue(inner);
    }
    static Dictionary<string, object> Run(Action write, Func<string> read, Action guard, Action delay) {
        return (Dictionary<string, object>)method.Invoke(null, new object[] {write, read, guard, delay, "new"});
    }
    static void Uncertain(Action write, Func<string> read, Action guard, Action delay) {
        try { Run(write, read, guard, delay); throw new Exception("expected uncertainty"); }
        catch (TargetInvocationException error) { Require(Code(error)=="input_outcome_unknown", "expected unknown input outcome"); }
    }
    static int Main(string[] args) {
        try {
            var a=Assembly.LoadFrom(args[0]);
            method=a.GetType("Axon.Program",true).GetMethod("WriteValuePattern",BindingFlags.NonPublic|BindingFlags.Static);
            var verify=a.GetType("Axon.Program",true).GetMethod("ConfirmsTextEdit",BindingFlags.NonPublic|BindingFlags.Static);
            Func<string,string,string,bool> confirmed=(before,after,text)=>(bool)verify.Invoke(null,new object[]{before,after,text});
            Require(confirmed("", "post", "post") && confirmed("ac","abc","b"),"inserted text was not confirmed");
            Require(confirmed("aOLDc","aNEWc","NEW"),"selection replacement was not confirmed");
            Require(!confirmed("","","post") && !confirmed(null,"post","post"),"unreadable or empty editor confirmed a write");
            Require(!confirmed("post xxx","post yyy","post") && !confirmed("","po","post"),"unrelated or partial change confirmed a write");
            int writes=0; string value="old";
            var exact=Run(()=>{writes++;value="new";},()=>value,()=>{},()=>{});
            Require(writes==1 && (string)exact["value"]=="new", "exact value was not confirmed");
            writes=0;value="old";
            var normal=Run(()=>{writes++;value="NEW";},()=>value,()=>{},()=>{});
            Require(writes==1 && (bool)normal["normalised_by_app"], "normalised value was not reported");
            writes=0;value="old";
            Uncertain(()=>{writes++;value="new";throw new Exception("failed after dispatch");},()=>value,()=>{},()=>{});
            Require(writes==1 && value=="new", "setter failure was repeated or effect was lost");
            writes=0;value="old";
            Uncertain(()=>{writes++;},()=>value,()=>{},()=>{});
            Require(writes==1, "unconfirmed write was repeated");
            writes=0;
            Uncertain(()=>{writes++;},()=>{throw new Exception("unreadable");},()=>{},()=>{});
            Require(writes==1, "unreadable provider write was repeated");
            Console.WriteLine("PASS native value dispatch and uncertain outcomes; no input APIs used");return 0;
        } catch(Exception error) { Console.Error.WriteLine(error);return 1; }
    }
}
