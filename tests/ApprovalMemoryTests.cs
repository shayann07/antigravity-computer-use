using System;using System.IO;using Axon;
internal static class ApprovalMemoryTests {
    static int count;
    static void Check(bool ok,string name) {if(!ok)throw new Exception(name);count++;Console.WriteLine("PASS "+name);}
    static int Main(string[] args) {
        try {
            string dir=args[0],file=Path.Combine(dir,"guardian-approvals.json");double now=1800000000;
            const string notepad="c:\\windows\\system32\\notepad.exe",terminal="c:\\apps\\terminal.exe";
            if(File.Exists(file))File.Delete(file);

            ApprovalMemory m=ApprovalMemory.Load(file,now);
            Check(m.Conversations==0&&!m.Allows("a",notepad,"full",now),"a missing file is an empty record");
            Check(m.Remember("a",notepad,"full",now)&&m.Allows("a",notepad,"full",now),"a human Allow is remembered for its conversation");
            Check(!m.Allows("b",notepad,"full",now),"another conversation always asks");
            Check(!m.Allows("a",terminal,"full",now),"the handle alone approves nothing");
            Check(m.Allows("a",notepad,"click",now),"a full approval covers a click-only request");
            Check(m.Remember("a",terminal,"click",now)&&m.Allows("a",terminal,"click",now)&&!m.Allows("a",terminal,"full",now),"a click-only approval never covers full control");
            Check(!m.Remember("a",notepad,"read",now)&&!m.Allows("a",notepad,"read",now),"a tier with no rule is neither stored nor allowed");
            Check(!m.Remember("",notepad,"full",now)&&!m.Remember(new string('h',65),notepad,"full",now)&&!m.Remember("a","","full",now),"empty or oversized keys are refused");

            Check(m.Save(file),"the record saves");
            ApprovalMemory again=ApprovalMemory.Load(file,now+60);
            Check(again.Allows("a",notepad,"full",now+60)&&again.Allows("a",terminal,"click",now+60)&&!again.Allows("a",terminal,"full",now+60),"a restart keeps the apps and their tiers");
            Check(!ApprovalMemory.Load(file,now+ApprovalMemory.IdleSeconds+1).Allows("a",notepad,"full",now+ApprovalMemory.IdleSeconds+1),"24 hours without use ends the approval");
            Check(!ApprovalMemory.Load(file,now-3600).Allows("a",notepad,"full",now-3600),"a record dated in the future is ignored");

            ApprovalMemory full=new ApprovalMemory();
            for(int i=0;i<ApprovalMemory.MaxConversations;i++)full.Remember("h"+i,notepad,"full",now+i);
            full.Remember("h0",notepad,"full",now+500);   // used again: no longer the oldest
            full.Remember("new",notepad,"full",now+600);
            Check(full.Conversations==ApprovalMemory.MaxConversations&&full.Allows("new",notepad,"full",now+600)&&full.Allows("h0",notepad,"full",now+600)&&!full.Allows("h1",notepad,"full",now+600)&&full.Allows("h2",notepad,"full",now+600),"a full table drops only the conversation used longest ago");

            ApprovalMemory apps=new ApprovalMemory();
            for(int i=0;i<ApprovalMemory.MaxApps;i++)apps.Remember("a","c:\\app"+i+".exe","full",now);
            Check(!apps.Remember("a","c:\\one-more.exe","full",now)&&!apps.Allows("a","c:\\one-more.exe","full",now)&&apps.Allows("a","c:\\app0.exe","full",now),"a conversation holds 64 apps and the rest ask again");

            foreach(string bad in new string[]{"","not json","[]","{\"schema\":2,\"sessions\":{}}","{\"schema\":1}","{\"schema\":1,\"sessions\":{\"a\":{\"seen\":\"x\",\"apps\":{\"c:\\\\n.exe\":\"full\"}}}}","{\"schema\":1,\"sessions\":{\"a\":{\"seen\":1800000000,\"apps\":{\"c:\\\\n.exe\":\"admin\"}}}}"}) {
                File.WriteAllText(file,bad);
                Check(ApprovalMemory.Load(file,now).Conversations==0,"a damaged file is an empty record: "+(bad.Length>24?bad.Substring(0,24):bad));
            }
            File.WriteAllText(file,new string(' ',ApprovalMemory.MaxBytes+1));
            Check(ApprovalMemory.Load(file,now).Conversations==0,"an oversized file is ignored");
            File.Delete(file);Directory.CreateDirectory(file);
            Check(ApprovalMemory.Load(file,now).Conversations==0&&!m.Save(file),"a directory in the file's place is neither read nor replaced");
            Directory.Delete(file);

            Console.WriteLine("TOTAL "+count);return 0;
        } catch(Exception e) {Console.WriteLine("FAIL "+e.Message);return 1;}
    }
}
