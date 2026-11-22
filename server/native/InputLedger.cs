// Original adaptation: persist only inputs this runtime may have held. The
// independent recovery process can release them after a worker is terminated.
using System;
using System.IO;
using System.Collections.Generic;
using System.Security.Cryptography;
using System.Text;
using System.Threading;

namespace Axon {
    internal static class InputLedger {
        static string FileName { get { return ControlFence.FileName + ".inputs"; } }
        static Mutex OpenMutex() {
            using(SHA256 hash=SHA256.Create()) {
                string id=BitConverter.ToString(hash.ComputeHash(Encoding.UTF8.GetBytes(FileName.ToLowerInvariant()))).Replace("-","");
                return new Mutex(false,"Local\\AGCU-input-"+id);
            }
        }
        static bool Enter(Mutex mutex) {
            try {return mutex.WaitOne(2000);}catch(AbandonedMutexException){return true;}
        }
        static HashSet<string> Read() {return new HashSet<string>(AtomicFile.ReadAllLines(FileName));}
        static void Save(HashSet<string> held) {
            string temp=FileName+"."+System.Diagnostics.Process.GetCurrentProcess().Id+".tmp";
            // Flush before injection: a hard-killed worker must leave a record.
            using(FileStream stream=new FileStream(temp,FileMode.Create,FileAccess.Write,FileShare.None)) {
                byte[] bytes=Encoding.UTF8.GetBytes(String.Join("\n",held));stream.Write(bytes,0,bytes.Length);stream.Flush(true);
            }
            AtomicFile.Publish(temp,FileName);
        }
        static string Key(Native.INPUT input,out bool down) {
            down=false;
            if(input.type==1) {down=(input.u.ki.dwFlags&2)==0;return "k:"+input.u.ki.wVk+":"+input.u.ki.wScan+":"+(input.u.ki.dwFlags&5);}
            if(input.type!=0)return null;
            uint f=input.u.mi.dwFlags;
            foreach(uint d in new uint[]{2,8,32})if((f&(d|d*2))!=0){down=(f&d)!=0;return "m:"+(d*2);}
            return null;
        }
        internal static void Send(Native.INPUT[] events) {
            if(String.IsNullOrEmpty(ControlFence.FileName)||!File.Exists(FileName))
                throw new AxonError("input_cleanup_failed","Input ledger is missing; no input was sent.",null);
            bool tracked=false;foreach(var e in events){bool down;if(Key(e,out down)!=null){tracked=true;break;}}
            if(!tracked){if(Native.SendInput((uint)events.Length,events,Native.InputSize)!=(uint)events.Length)Reject();return;}
            using(Mutex mutex=OpenMutex()) {
                if(!Enter(mutex))throw new IOException("Input journal unavailable; no input sent.");
                try {
                    var held=Read();
                    foreach(var e in events){bool down;string key=Key(e,out down);if(key!=null&&down)held.Add(key);}
                    Save(held);
                    foreach(var e in events){bool down;if(Key(e,out down)!=null&&down){ControlFence.Check();break;}}
                    uint sent=Native.SendInput((uint)events.Length,events,Native.InputSize);
                    // Only delivered up events discharge ownership. A partial
                    // SendInput keeps the remaining releases recoverable.
                    for(int i=0;i<sent;i++){bool down;string key=Key(events[i],out down);if(key!=null&&!down)held.Remove(key);}
                    Save(held);if(sent!=(uint)events.Length)Reject();
                }finally {mutex.ReleaseMutex();}
            }
        }
        static void Reject(){throw new AxonError("input_rejected","Windows rejected or partially delivered input. Observe before retrying.",null);}
        internal static void Recover() {
            if(String.IsNullOrEmpty(ControlFence.FileName))return;
            using(Mutex mutex=OpenMutex()) {
                if(!Enter(mutex))return;
                try {
                    var held=Read();
                    foreach(string key in new List<string>(held)) {
                        try {
                            string[] p=key.Split(':');Native.INPUT input;
                            if(p[0]=="k"&&p.Length==4)input=Native.KeyInput(UInt16.Parse(p[1]),UInt16.Parse(p[2]),UInt32.Parse(p[3])|2);
                            else if(p[0]=="m"&&p.Length==2)input=Native.MouseInput(UInt32.Parse(p[1]),0);
                            else continue;
                            if(Native.SendInput(1,new Native.INPUT[]{input},Native.InputSize)==1)held.Remove(key);
                        }catch { /* Continue independent releases after failure. */ }
                    }
                    Save(held);
                }finally{mutex.ReleaseMutex();}
            }
        }
        internal static bool HasHeld() {
            if(String.IsNullOrEmpty(ControlFence.FileName))return true;
            try {using(Mutex mutex=OpenMutex()) {
                if(!Enter(mutex))return true;
                try {return Read().Count!=0;}finally {mutex.ReleaseMutex();}
            }}catch {return true;}
        }
    }
}
