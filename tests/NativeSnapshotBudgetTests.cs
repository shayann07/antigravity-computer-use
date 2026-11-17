using System;
using System.Reflection;
class NativeSnapshotBudgetTests {
 static int Main(string[] args) { try {
  var assembly=Assembly.LoadFrom(args[0]);
  var method=assembly.GetType("Axon.Program",true).GetMethod("SnapshotWalkBudget",BindingFlags.NonPublic|BindingFlags.Static);
  Check(method,8000,null,8000); Check(method,8000,250,250); Check(method,8000,1,100);
  Check(method,50,1000,50); Check(method,8000,9000,8000); Check(method,8000,"bad",8000);
  var repeats=assembly.GetType("Axon.Program",true).GetMethod("SiblingChainRepeats",BindingFlags.NonPublic|BindingFlags.Static);
  // Paint's custom colour grid: every sibling is the first one again.
  Loop(repeats,true,new int[]{42,854370,4,257},new int[]{42,854370,4,257},new int[]{42,854370,4,257});
  Loop(repeats,true,new int[]{1,2},new int[]{1,3},new int[]{1,2});
  Loop(repeats,false,new int[]{1,2},new int[]{1,3},new int[]{1,4});
  Loop(repeats,false,new int[]{1,2});
  Loop(repeats,false,null,null,new int[0],new int[0]);
  Console.WriteLine("PASS native snapshot budget policy; no input APIs used"); return 0;
 } catch(Exception error) { Console.Error.WriteLine(error); return 1; } }
 static void Loop(MethodInfo method,bool expected,params int[][] ids) {
  bool actual=(bool)method.Invoke(null,new object[]{ids});
  if(actual!=expected)throw new Exception("Sibling loop mismatch: expected="+expected);
 }
 static void Check(MethodInfo method,int configured,object requested,int expected) {
  int actual=(int)method.Invoke(null,new object[]{configured,requested});
  if(actual!=expected)throw new Exception("Budget mismatch: expected="+expected+" actual="+actual);
 }
}
