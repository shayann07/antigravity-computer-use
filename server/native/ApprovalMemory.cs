// The apps a person approved in this guardian's own prompts, per agent
// conversation, kept beside the guard files so a guardian restart or an update
// does not ask again. Separate from the window code so the rules can be tested
// without showing a prompt.
//
// Only a human Allow is ever recorded. The runtime's claim that an app was
// approved is never enough on its own: the handle, the executable and the
// access tier must all match this record.
using System;
using System.IO;
using System.Collections.Generic;
using System.Web.Script.Serialization;

namespace Axon {
    internal sealed class ApprovalMemory {
        internal const int MaxConversations=64,MaxApps=64,MaxBytes=256*1024,MaxHandle=64,MaxPath=1024;
        internal const double IdleSeconds=24*60*60;
        sealed class Record {internal double Seen;internal readonly Dictionary<string,string> Apps=new Dictionary<string,string>(StringComparer.Ordinal);}
        readonly Dictionary<string,Record> table=new Dictionary<string,Record>(StringComparer.Ordinal);

        internal static double Now() {return (DateTime.UtcNow-new DateTime(1970,1,1,0,0,0,DateTimeKind.Utc)).TotalSeconds;}
        internal int Conversations {get {return table.Count;}}
        static bool Tier(string tier) {return tier=="full"||tier=="click";}
        static bool Handle(string handle) {return !String.IsNullOrEmpty(handle)&&handle.Length<=MaxHandle;}
        static bool Executable(string path) {return !String.IsNullOrEmpty(path)&&path.Length<=MaxPath&&path.IndexOf('\0')<0;}
        // A stored approval covers a request for the same tier or a narrower one.
        internal static bool Covers(string stored,string requested) {
            if(!Tier(stored)||!Tier(requested))return false;
            return stored=="full"||requested=="click";
        }
        static bool Live(Record record,double now) {return now-record.Seen<=IdleSeconds&&record.Seen<=now+60;}

        internal bool Allows(string handle,string executable,string tier,double now) {
            Record record;string stored;
            if(!Handle(handle)||!Executable(executable)||!table.TryGetValue(handle,out record)||!Live(record,now))return false;
            return record.Apps.TryGetValue(executable,out stored)&&Covers(stored,tier);
        }
        // Records a human Allow. The latest tier the person saw replaces an older one.
        internal bool Remember(string handle,string executable,string tier,double now) {
            if(!Handle(handle)||!Executable(executable)||!Tier(tier))return false;
            Prune(now);
            Record record;
            if(!table.TryGetValue(handle,out record)) {
                // Full: the conversation used longest ago makes room.
                while(table.Count>=MaxConversations) {
                    string oldest=null;double when=Double.MaxValue;
                    foreach(KeyValuePair<string,Record> entry in table)if(entry.Value.Seen<when){when=entry.Value.Seen;oldest=entry.Key;}
                    if(oldest==null)break;
                    table.Remove(oldest);
                }
                record=new Record();table[handle]=record;
            }
            record.Seen=now;
            if(!record.Apps.ContainsKey(executable)&&record.Apps.Count>=MaxApps)return false;
            record.Apps[executable]=tier;
            return true;
        }
        internal void Prune(double now) {
            List<string> gone=new List<string>();
            foreach(KeyValuePair<string,Record> entry in table)if(!Live(entry.Value,now)||entry.Value.Apps.Count==0)gone.Add(entry.Key);
            foreach(string key in gone)table.Remove(key);
        }

        // A missing, linked, oversized or malformed file is an empty record:
        // the person is asked again.
        internal static ApprovalMemory Load(string file,double now) {
            ApprovalMemory memory=new ApprovalMemory();
            try {
                FileInfo info=new FileInfo(file);
                if(!info.Exists||(info.Attributes&(FileAttributes.ReparsePoint|FileAttributes.Directory))!=0||info.Length>MaxBytes)return memory;
                Dictionary<string,object> root=new JavaScriptSerializer().DeserializeObject(File.ReadAllText(file)) as Dictionary<string,object>;
                if(root==null||!root.ContainsKey("schema")||Convert.ToInt32(root["schema"])!=1)return memory;
                Dictionary<string,object> sessions=root.ContainsKey("sessions")?root["sessions"] as Dictionary<string,object>:null;
                if(sessions==null)return memory;
                foreach(KeyValuePair<string,object> session in sessions) {
                    Dictionary<string,object> saved=session.Value as Dictionary<string,object>;
                    if(!Handle(session.Key)||saved==null||!saved.ContainsKey("seen")||!saved.ContainsKey("apps"))continue;
                    Dictionary<string,object> apps=saved["apps"] as Dictionary<string,object>;
                    if(apps==null)continue;
                    Record record=new Record();
                    try {record.Seen=Convert.ToDouble(saved["seen"]);} catch {continue;}
                    foreach(KeyValuePair<string,object> app in apps) {
                        string tier=app.Value as string;
                        if(Executable(app.Key)&&Tier(tier)&&record.Apps.Count<MaxApps)record.Apps[app.Key]=tier;
                    }
                    if(record.Apps.Count>0&&memory.table.Count<MaxConversations)memory.table[session.Key]=record;
                }
                memory.Prune(now);
            } catch {memory.table.Clear();}
            return memory;
        }
        // Replaces the file in one step. A failed save only means the person
        // is asked again after a restart.
        internal bool Save(string file) {
            try {
                Dictionary<string,object> sessions=new Dictionary<string,object>();
                foreach(KeyValuePair<string,Record> entry in table) {
                    Dictionary<string,object> apps=new Dictionary<string,object>();
                    foreach(KeyValuePair<string,string> app in entry.Value.Apps)apps[app.Key]=app.Value;
                    sessions[entry.Key]=new Dictionary<string,object>{{"seen",Math.Floor(entry.Value.Seen)},{"apps",apps}};
                }
                string text=new JavaScriptSerializer().Serialize(new Dictionary<string,object>{{"schema",1},{"sessions",sessions}});
                if(text.Length>MaxBytes)return false;
                string temp=file+".tmp";
                File.WriteAllText(temp,text);
                if(File.Exists(file)) {
                    if((File.GetAttributes(file)&(FileAttributes.ReparsePoint|FileAttributes.Directory))!=0){File.Delete(temp);return false;}
                    File.Replace(temp,file,null);
                } else File.Move(temp,file);
                return true;
            } catch {return false;}
        }
    }
}
