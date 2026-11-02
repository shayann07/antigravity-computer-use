using System;
using System.IO;
using System.Reflection;
using System.Diagnostics;
using System.Threading;
using System.Threading.Tasks;

// Exercise the real metadata writer without creating a guardian or sending input.
class NativeWatchdogMetadataTests {
    static int Main(string[] args) {
        if(args.Length==1&&args[0]=="--hold") { Console.WriteLine("ready");Console.Out.Flush();Thread.Sleep(30000);return 0; }
        try {
            var host=Assembly.LoadFrom(args[0]);var type=host.GetType("Axon.CursorSafety",true);
            var write=type.GetMethod("WriteWatchdogRecord",BindingFlags.Static|BindingFlags.NonPublic);
            var receipt=host.GetType("Axon.NativeStopReceipt",true);
            var nonceValid=receipt.GetMethod("ValidNonce",BindingFlags.Static|BindingFlags.NonPublic);
            if(!(bool)nonceValid.Invoke(null,new object[]{new string('a',32)})||(bool)nonceValid.Invoke(null,new object[]{new string('a',32)+"\n"})||(bool)nonceValid.Invoke(null,new object[]{null}))throw new Exception("Stop receipt nonce validation differs");
            var exited=receipt.GetMethod("WorkersExited",BindingFlags.Static|BindingFlags.NonPublic);
            var nativeStop=host.GetType("Axon.ControlFence",true).GetMethod("LatchStop",BindingFlags.Static|BindingFlags.NonPublic);
            string stop=Path.Combine(args[1],"emergency.stop");Environment.SetEnvironmentVariable("AGCU_STOP_LATCH",stop);
            nativeStop.Invoke(null,null);if(File.ReadAllText(stop)!="stopped")throw new Exception("native Stop creation failed");
            File.WriteAllText(stop,"unconfirmed:native-regression");nativeStop.Invoke(null,null);nativeStop.Invoke(null,null);
            if(File.ReadAllText(stop)!="unconfirmed:native-regression")throw new Exception("native Stop downgraded uncertainty");
            File.WriteAllText(stop,"invalid-evidence");nativeStop.Invoke(null,null);
            if(File.ReadAllText(stop)!="invalid-evidence")throw new Exception("native Stop overwrote existing evidence");
            File.Delete(stop);File.WriteAllText(stop+".unconfirmed","unconfirmed:companion");
            var blocks=host.GetType("Axon.ControlFence",true).GetMethod("LatchBlocks",BindingFlags.Static|BindingFlags.NonPublic);
            if(!(bool)blocks.Invoke(null,new object[]{stop}))throw new Exception("native Stop ignored a companion-only fence");
            File.Delete(stop+".unconfirmed");
            if((bool)blocks.Invoke(null,new object[]{stop}))throw new Exception("known absent Stop entries were blocked");
            var entryBlocks=host.GetType("Axon.ControlFence",true).GetMethod("LatchEntryBlocks",BindingFlags.Static|BindingFlags.NonPublic);
            string invalidParent=Path.Combine(args[1],"not-a-directory");File.WriteAllText(invalidParent,"fixture");
            if(!(bool)entryBlocks.Invoke(null,new object[]{Path.Combine(invalidParent,"child")}))throw new Exception("invalid Stop parent was treated as absence");
            Environment.SetEnvironmentVariable("AGCU_STOP_LATCH","");
            var check=host.GetType("Axon.ControlFence",true).GetMethod("CheckWatchdogIdentity",BindingFlags.Static|BindingFlags.NonPublic);
            var problem=host.GetType("Axon.ControlFence",true).GetMethod("WatchdogIdentityProblem",BindingFlags.Static|BindingFlags.NonPublic);
            var unchanged=host.GetType("Axon.ControlFence",true).GetMethod("GuardUnchanged",BindingFlags.Static|BindingFlags.NonPublic);
            Func<string,string,bool,bool> guardSame=delegate(string before,string after,bool latched){return (bool)unchanged.Invoke(null,new object[]{before,after,latched});};
            if(!guardSame("active","active",false)||guardSame("active","stopped",false)||guardSame("active","active",true)||guardSame(null,null,false))throw new Exception("guard revalidation differs");
            var confirm=host.GetType("Axon.ControlFence",true).GetMethod("ConfirmWatchdog",BindingFlags.Static|BindingFlags.NonPublic);
            int probes=0,waits=0;Func<string> transient=delegate {probes++;return probes==1?"identity_unavailable":null;};Action wait=delegate {waits++;};
            if(!(bool)confirm.Invoke(null,new object[]{transient,wait})||probes!=2||waits!=1)throw new Exception("transient identity revalidation differs");
            probes=0;waits=0;Func<string> unavailable=delegate {probes++;return "identity_unavailable";};
            if((bool)confirm.Invoke(null,new object[]{unavailable,wait})||probes!=3||waits!=2)throw new Exception("unavailable identity was accepted");
            var transition=host.GetType("Axon.Guardian",true).GetMethod("ResolveGuardState",BindingFlags.Static|BindingFlags.NonPublic);
            Func<string,long,long,bool,string> resolve=delegate(string state,long before,long after,bool latched){return (string)transition.Invoke(null,new object[]{state,before,after,latched});};
            if(resolve("idle",1,2,false)!="stopped"||resolve("active",1,1,true)!="stopped"||resolve("idle",2,2,false)!="idle"||resolve("stopped",1,2,false)!="stopped")throw new Exception("emergency stop transition lost");
            var watchdogState=type.GetMethod("WatchdogState",BindingFlags.Static|BindingFlags.NonPublic);
            Func<string,ulong,string> classify=delegate(string value,ulong now){return (string)watchdogState.Invoke(null,new object[]{value,now});};
            if(classify("active|token|10000||500",499)!="active"||classify("active|token|10000||500",500)!="expired"||
               classify("active|token|10000|",10)!="invalid"||classify(null,10)!="invalid"||classify("stopped||0|",10)!="inactive")throw new Exception("watchdog state classification differs");
            var grace=type.GetMethod("WatchdogGraceElapsed",BindingFlags.Static|BindingFlags.NonPublic);
            Func<string,ulong,ulong,bool> elapsed=delegate(string state,ulong since,ulong now){return (bool)grace.Invoke(null,new object[]{state,since,now});};
            if(elapsed("invalid",100,1099)||!elapsed("invalid",100,1100)||elapsed("expired",100,5099)||!elapsed("expired",100,5100)||elapsed("inactive",100,99)||elapsed("active",100,10000))throw new Exception("watchdog grace boundary differs");
            var deadline=host.GetType("Axon.NativeDeadline",true);
            var create=deadline.GetMethod("Create",BindingFlags.Static|BindingFlags.NonPublic);
            var valid=deadline.GetMethod("Valid",BindingFlags.Static|BindingFlags.NonPublic);
            ulong bounded=(ulong)create.Invoke(null,new object[]{100000000L,0L,1000UL,500});
            if(bounded!=1500UL||!(bool)valid.Invoke(null,new object[]{bounded,1499UL})||(bool)valid.Invoke(null,new object[]{bounded,1500UL}))throw new Exception("monotonic deadline boundary differs");
            if((ulong)create.Invoke(null,new object[]{100L,100L,10UL,500})!=0UL||(ulong)create.Invoke(null,new object[]{100000000L,0L,UInt64.MaxValue-1,500})!=0UL)throw new Exception("invalid deadline accepted");
            string file=Path.Combine(args[1],"guard.watchdog");
            write.Invoke(null,new object[]{file,101,123L});
            if(File.ReadAllText(file)!="101|123")throw new Exception("initial record mismatch");
            write.Invoke(null,new object[]{file,102,456L});
            if(File.ReadAllText(file)!="102|456")throw new Exception("replacement mismatch");
            using(var held=new FileStream(file,FileMode.Open,FileAccess.Read,FileShare.Read)) {
                bool failed=false;try{write.Invoke(null,new object[]{file,103,789L});}catch(TargetInvocationException){failed=true;}
                if(!failed)throw new Exception("locked replacement unexpectedly succeeded");
            }
            if(File.ReadAllText(file)!="102|456")throw new Exception("failed replacement changed prior record");
            if(Directory.GetFiles(args[1],"*.tmp").Length!=0)throw new Exception("unpublished temporary record remains");
            string guard=Path.Combine(args[1],"identity");
            Action mustRefuse=delegate { bool failed=false;try{check.Invoke(null,new object[]{guard});}catch(TargetInvocationException){failed=true;}if(!failed)throw new Exception("invalid watchdog identity accepted"); };
            mustRefuse();File.WriteAllText(guard+".watchdog","invalid");mustRefuse();
            File.WriteAllText(guard+".watchdog",new string('9',129));mustRefuse();
            File.WriteAllBytes(guard+".watchdog",new byte[]{0xff});mustRefuse();
            var fence=host.GetType("Axon.ControlFence",true);fence.GetField("Token",BindingFlags.Static|BindingFlags.NonPublic).SetValue(null,"fixture");
            var nativeCheck=fence.GetMethod("Check",BindingFlags.Static|BindingFlags.NonPublic);
            Environment.SetEnvironmentVariable("AGCU_GUARD_FILE",guard);Environment.SetEnvironmentVariable("AGCU_STOP_LATCH","");
            Action fenceMustRefuse=delegate { bool failed=false;try{nativeCheck.Invoke(null,null);}catch(TargetInvocationException){failed=true;}if(!failed)throw new Exception("unbounded active state accepted"); };
            File.WriteAllText(guard,"active|fixture|"+DateTime.UtcNow.AddMinutes(5).Ticks+"|");fenceMustRefuse();
            File.WriteAllText(guard,"active|fixture|"+DateTime.UtcNow.AddMinutes(5).Ticks+"||0");fenceMustRefuse();
            var info=new ProcessStartInfo(Process.GetCurrentProcess().MainModule.FileName,"--hold");info.UseShellExecute=false;info.CreateNoWindow=true;info.RedirectStandardOutput=true;
            using(Process child=Process.Start(info)) {
                try {
                    var ready=Task.Factory.StartNew(delegate{return child.StandardOutput.ReadLine();});
                    if(!ready.Wait(5000)||ready.Result!="ready")throw new Exception("identity fixture did not report ready");
                    long born=child.StartTime.ToUniversalTime().Ticks;
                    File.WriteAllText(guard+".watchdog",child.Id+"|"+(born+1));mustRefuse();
                    File.WriteAllText(guard+".watchdog",child.Id+"|"+born);
                    string why=(string)problem.Invoke(null,new object[]{guard});if(why!=null)throw new Exception("valid child rejected: "+why);
                    check.Invoke(null,new object[]{guard});
                    var timing=Stopwatch.StartNew();for(int i=0;i<100;i++)try{check.Invoke(null,new object[]{guard});}catch(TargetInvocationException){throw new Exception("valid child rejected during sample "+i+": "+((string)problem.Invoke(null,new object[]{guard})??"transient"));}timing.Stop();
                    Console.WriteLine("100 watchdog identity checks (ms): "+timing.Elapsed.TotalMilliseconds.ToString("F1"));
                    if((bool)exited.Invoke(null,new object[]{new Process[]{child},0}))throw new Exception("live worker was acknowledged as exited");
                    child.Kill();child.WaitForExit();mustRefuse();
                    if(!(bool)exited.Invoke(null,new object[]{new Process[]{child},0}))throw new Exception("confirmed exited worker was rejected");
                }finally{if(!child.HasExited){child.Kill();child.WaitForExit();}}
            }
            Console.WriteLine("PASS watchdog metadata create, replace and failed replacement; no input APIs used");return 0;
        }catch(Exception error){Console.Error.WriteLine(error);return 1;}
    }
}
