// Original Windows per-user storage boundary. No desktop/input APIs or elevation.
// https://learn.microsoft.com/dotnet/api/system.security.accesscontrol.directorysecurity
// https://learn.microsoft.com/windows/win32/fileio/file-security-and-access-rights
using System;
using System.IO;
using System.Text;
using System.Collections.Generic;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Web.Script.Serialization;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Threading;

internal static class StorageGuard {
    static readonly SecurityIdentifier Me=WindowsIdentity.GetCurrent().User;
    static readonly SecurityIdentifier SystemSid=new SecurityIdentifier(WellKnownSidType.LocalSystemSid,null);
    static readonly SecurityIdentifier AdminSid=new SecurityIdentifier(WellKnownSidType.BuiltinAdministratorsSid,null);
    static readonly SecurityIdentifier TrustedInstallerSid=new SecurityIdentifier("S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464");
    const string Marker=".agcu-private-storage";
    // Identical to the existing data preparation path, but executed after the
    // kernel mutex is held so the caller need not start a second helper.
    static void PrepareLeaseData(string root) {
        Owner(root);if(!OwnData(root))Refuse("storage_not_dedicated",root,"Refusing to change permissions of an unrelated nonempty directory.");
        var paths=Tree(root);
        foreach(string path in paths)try{Protect(path);}catch(Exception error){Refuse("storage_permissions_failed",path,error.Message);}
        string marker=Path.Combine(root,Marker);File.WriteAllText(marker,"antigravity-computer-use-private-storage-v1\n",new UTF8Encoding(false));Protect(marker);
        foreach(string path in paths)Verify(path,path==root);
    }
    [StructLayout(LayoutKind.Sequential)]struct FileIdentity {internal uint Attributes,CreateLow,CreateHigh,AccessLow,AccessHigh,WriteLow,WriteHigh,Volume,SizeHigh,SizeLow,Links,IndexHigh,IndexLow;}
    [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)]static extern IntPtr CreateFileW(string path,uint access,uint share,IntPtr security,uint disposition,uint flags,IntPtr template);
    [DllImport("kernel32.dll",SetLastError=true)]static extern bool GetFileInformationByHandle(IntPtr file,out FileIdentity info);
    [DllImport("kernel32.dll")]static extern bool CloseHandle(IntPtr handle);
    // Kernel ownership disappears on process death; no stale lock-file deletion
    // race. Global scope also covers another Windows session using this profile.
    static int Lease(string root){
        // Claim ownership before the parent initializes data ACLs/markers, so
        // simultaneous first starts cannot race that initialization either.
        string ancestor=root;while(!String.IsNullOrEmpty(ancestor)){if(Directory.Exists(ancestor))NoLink(ancestor);ancestor=Path.GetDirectoryName(ancestor);}
        if(Directory.Exists(root))Owner(root);
        // A filesystem identity also covers 8.3/case aliases. Keep the directory
        // handle without DELETE sharing so it cannot be replaced under a lease.
        IntPtr directory=CreateFileW(root,0x81,3,IntPtr.Zero,3,0x02200000,IntPtr.Zero); // LIST_DIRECTORY | READ_ATTRIBUTES
        if(directory==new IntPtr(-1))Refuse("service_ownership_unavailable",root,"Cannot open the controller data directory for ownership.");
        try{
            FileIdentity info;if(!GetFileInformationByHandle(directory,out info)||(info.Attributes&0x10)==0||(info.Attributes&0x400)!=0)Refuse("service_ownership_unavailable",root,"Controller ownership requires a real directory, not a link.");
            var volume=new StringBuilder(512);if(!GetVolumeNameForVolumeMountPoint(Path.GetPathRoot(root),volume,volume.Capacity))Refuse("service_ownership_unavailable",root,"Cannot identify the controller volume.");
            string identity=volume.ToString().ToUpperInvariant()+"|"+info.Volume.ToString("X8")+"|"+info.IndexHigh.ToString("X8")+info.IndexLow.ToString("X8"),name;
            using(var sha=SHA256.Create())name="Global\\AGCU.Service."+BitConverter.ToString(sha.ComputeHash(Encoding.UTF8.GetBytes(Me.Value+"|"+identity))).Replace("-","");
            var acl=new MutexSecurity();
            foreach(var sid in new SecurityIdentifier[]{Me,SystemSid,AdminSid})acl.AddAccessRule(new MutexAccessRule(sid,MutexRights.FullControl,AccessControlType.Allow));
            bool created,owned=false;
            using(var mutex=new Mutex(false,name,out created,acl)){
                try{
                    if(!Trusted(mutex.GetAccessControl().GetOwner(typeof(SecurityIdentifier))))Refuse("service_ownership_untrusted",root,"The controller ownership object has an unrelated owner.");
                    try{owned=mutex.WaitOne(0);}catch(AbandonedMutexException){owned=true;}
                    if(!owned)Refuse("service_already_running",root,"Another controller owns this private data directory. Reconnect to it; no competing runtime was started.");
                    PrepareLeaseData(root);
                    Console.WriteLine(new JavaScriptSerializer().Serialize(new {ok=true,lease_acquired=true,private_storage_verified=true,pid=System.Diagnostics.Process.GetCurrentProcess().Id}));Console.Out.Flush();
                    string line;while((line=Console.In.ReadLine())!=null){
                        var request=new JavaScriptSerializer().DeserializeObject(line) as Dictionary<string,object>;
                        if(request==null||!request.ContainsKey("op")||Convert.ToString(request["op"])!="publish_incidents"||Path.GetFileName(root)!="incident-writer-lease")throw new InvalidOperationException("Invalid lease operation.");
                        string parent=Path.GetDirectoryName(root),target=Path.Combine(parent,"incidents.json"),temp=Path.Combine(parent,".incident-publish.tmp");
                        byte[] bytes=Convert.FromBase64String(Convert.ToString(request["data"]));if(bytes.Length>256*1024)throw new InvalidOperationException("Incident journal exceeds limit.");
                        Verify(parent,true);if(File.Exists(target))Verify(target,false);
                        // Only the lease holder may recover this reserved file.
                        if(File.Exists(temp)){Verify(temp,false);File.Delete(temp);}
                        try{using(var stream=new FileStream(temp,FileMode.CreateNew,FileAccess.Write,FileShare.None)){stream.Write(bytes,0,bytes.Length);stream.Flush(true);}Verify(temp,false);
                            if(File.Exists(target))File.Replace(temp,target,null);else File.Move(temp,target);
                        }finally{if(File.Exists(temp))File.Delete(temp);}
                        Console.WriteLine(new JavaScriptSerializer().Serialize(new {ok=true,published=true}));Console.Out.Flush();
                    }
                    return 0;
                }finally{if(owned)mutex.ReleaseMutex();}
            }
        }finally{CloseHandle(directory);}
    }
    [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)]static extern bool GetVolumeNameForVolumeMountPoint(string mount,StringBuilder name,int length);
    sealed class Refusal : Exception {
        internal string Code,Target;
        internal Refusal(string code,string target,string message):base(message){Code=code;Target=target;}
    }
    static void Refuse(string code,string target,string message){throw new Refusal(code,target,message);}
    static bool Trusted(IdentityReference sid){return sid.Equals(Me)||sid.Equals(SystemSid)||sid.Equals(AdminSid);}
    static bool TrustedParent(IdentityReference sid){return Trusted(sid)||sid.Equals(TrustedInstallerSid);}
    static uint Rights(FileSystemAccessRule rule){
        uint value=unchecked((uint)rule.FileSystemRights);
        if((value&0x10000000)!=0)value|=0x1f01ff; // GENERIC_ALL
        if((value&0x80000000)!=0)value|=0x120089; // FILE_GENERIC_READ
        if((value&0x40000000)!=0)value|=0x120116; // FILE_GENERIC_WRITE
        if((value&0x20000000)!=0)value|=0x1200a0; // FILE_GENERIC_EXECUTE
        return value&0x0fffffff;
    }
    static FileSystemSecurity Security(string path){
        return Directory.Exists(path)?(FileSystemSecurity)new DirectoryInfo(path).GetAccessControl():new FileInfo(path).GetAccessControl();
    }
    static string Canonical(string value){
        string path=Path.GetFullPath(value).TrimEnd(Path.DirectorySeparatorChar,Path.AltDirectorySeparatorChar);
        string volume=Path.GetPathRoot(Path.GetFullPath(value));
        if(volume.StartsWith("\\\\"))Refuse("local_storage_required",path,"Use a local ACL-capable drive.");
        var volumeName=new StringBuilder(512);
        if(!GetVolumeNameForVolumeMountPoint(volume,volumeName,volumeName.Capacity))Refuse("local_storage_required",path,"Use a real local volume root; substituted/network drive aliases are not supported.");
        if(String.Equals(path,volume.TrimEnd('\\','/'),StringComparison.OrdinalIgnoreCase))Refuse("unsafe_storage_root",path,"A drive root is not a dedicated application folder.");
        foreach(Environment.SpecialFolder kind in new Environment.SpecialFolder[]{Environment.SpecialFolder.UserProfile,Environment.SpecialFolder.Windows,Environment.SpecialFolder.ProgramFiles,Environment.SpecialFolder.ProgramFilesX86,Environment.SpecialFolder.ApplicationData,Environment.SpecialFolder.LocalApplicationData,Environment.SpecialFolder.CommonApplicationData,Environment.SpecialFolder.Desktop,Environment.SpecialFolder.MyDocuments}){
            string special=Environment.GetFolderPath(kind);
            if(!String.IsNullOrEmpty(special)&&String.Equals(path,special.TrimEnd('\\','/'),StringComparison.OrdinalIgnoreCase))Refuse("unsafe_storage_root",path,"Use a dedicated subfolder, not a user/system root.");
        }
        return path;
    }
    static void NoLink(string path){if((File.GetAttributes(path)&FileAttributes.ReparsePoint)!=0)Refuse("storage_link_refused",path,"Storage links/reparse points are not followed.");}
    static void Owner(string path){
        NoLink(path);
        if(!Trusted(Security(path).GetOwner(typeof(SecurityIdentifier))))Refuse("storage_owner_mismatch",path,"An unrelated account owns this storage entry.");
    }
    static void Ancestors(string path){
        string parent=Path.GetDirectoryName(path);
        while(!String.IsNullOrEmpty(parent)){
            if(Directory.Exists(parent)){
                NoLink(parent);
                var parentAcl=Security(parent);
                if(!TrustedParent(parentAcl.GetOwner(typeof(SecurityIdentifier)))||new RawSecurityDescriptor(parentAcl.GetSecurityDescriptorBinaryForm(),0).DiscretionaryAcl==null)
                    Refuse("insecure_storage_ancestor",parent,"The ancestor has an unrelated owner or grants unrestricted access.");
                bool volume=String.Equals(parent.TrimEnd('\\','/'),Path.GetPathRoot(parent).TrimEnd('\\','/'),StringComparison.OrdinalIgnoreCase);
                uint unsafeRights=0x40000|0x80000|0x40; // WRITE_DAC, WRITE_OWNER, DELETE_CHILD
                if(!volume)unsafeRights|=0x10000; // An ancestor that others can rename can replace the entire install path.
                foreach(FileSystemAccessRule rule in parentAcl.GetAccessRules(true,true,typeof(SecurityIdentifier))){
                    if(rule.AccessControlType!=AccessControlType.Allow||(rule.PropagationFlags&PropagationFlags.InheritOnly)!=0||TrustedParent(rule.IdentityReference))continue;
                    if((Rights(rule)&unsafeRights)!=0)Refuse("insecure_storage_ancestor",parent,"Another local account can replace an ancestor. Choose a private folder under the drive root or user profile; parent permissions were not changed.");
                }
            }
            string next=Path.GetDirectoryName(parent);if(next==parent)break;parent=next;
        }
    }
    static List<string> Tree(string root){
        var entries=new List<string>();var pending=new Stack<string>();pending.Push(root);
        while(pending.Count>0){string path=pending.Pop();Owner(path);entries.Add(path);if(Directory.Exists(path))foreach(string child in Directory.EnumerateFileSystemEntries(path))pending.Push(child);}
        return entries;
    }
    static DirectorySecurity DirectoryAcl(bool create=false){
        var acl=new DirectorySecurity();if(create)acl.SetOwner(Me);acl.SetAccessRuleProtection(true,false);
        foreach(var sid in new SecurityIdentifier[]{Me,SystemSid,AdminSid})acl.AddAccessRule(new FileSystemAccessRule(sid,FileSystemRights.FullControl,InheritanceFlags.ContainerInherit|InheritanceFlags.ObjectInherit,PropagationFlags.None,AccessControlType.Allow));
        return acl;
    }
    static void Protect(string path){
        if(Directory.Exists(path))new DirectoryInfo(path).SetAccessControl(DirectoryAcl());
        else {
            var acl=new FileSecurity();acl.SetAccessRuleProtection(true,false);
            foreach(var sid in new SecurityIdentifier[]{Me,SystemSid,AdminSid})acl.AddAccessRule(new FileSystemAccessRule(sid,FileSystemRights.FullControl,AccessControlType.Allow));
            new FileInfo(path).SetAccessControl(acl);
        }
    }
    static void Verify(string path,bool root){
        Owner(path);var acl=Security(path);
        if(new RawSecurityDescriptor(acl.GetSecurityDescriptorBinaryForm(),0).DiscretionaryAcl==null)Refuse("storage_not_private",path,"A null access list grants unrestricted access.");
        bool ownerFull=false;
        foreach(FileSystemAccessRule rule in acl.GetAccessRules(true,true,typeof(SecurityIdentifier))){
            if(rule.AccessControlType!=AccessControlType.Allow)Refuse("storage_permissions_conflict",path,"Unexpected deny rules conflict with the dedicated private storage policy.");
            if(!Trusted(rule.IdentityReference)&&Rights(rule)!=0)Refuse("storage_not_private",path,"Storage grants access to an unrelated principal.");
            if(rule.IdentityReference.Equals(Me)&&(rule.PropagationFlags&PropagationFlags.InheritOnly)==0&&(Rights(rule)&0x1f01ff)==0x1f01ff)ownerFull=true;
        }
        if(!ownerFull)Refuse("storage_owner_access_missing",path,"The current user lacks the explicit full access required for this private storage.");
        if(root&&!acl.AreAccessRulesProtected&&Directory.Exists(path))Refuse("storage_inherits_permissions",path,"The private root must not inherit broader permissions.");
    }
    static bool OwnInstall(string root){
        if(!Directory.Exists(root)||(!File.Exists(Path.Combine(root,"installation.json"))&&!File.Exists(Path.Combine(root,Marker))))return false;
        foreach(string path in Directory.EnumerateFileSystemEntries(root)){
            string name=Path.GetFileName(path);
            // Updater-owned metadata is part of this dedicated installation.
            // Keep this an exact allowlist: a marker never permits unrelated data.
            if(name=="updates"||name=="update-settings.json"||name=="update-state.json"||name=="update-worker-result.json"||name=="update-switching.json"||name=="update.lock")continue;
            if(System.Text.RegularExpressions.Regex.IsMatch(name,@"^\.(?:installation|deployments|update-settings|update-state|update-switching|update-worker-result)\.json\.[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.tmp$"))continue;
            if(System.Text.RegularExpressions.Regex.IsMatch(name,@"^Start Computer Use(?:-[a-f0-9]{12})?\.cmd(?:\.agcu\.tmp)?$",System.Text.RegularExpressions.RegexOptions.IgnoreCase))continue;
            if(name=="releases"||name=="data"||name=="backups"||name=="installation.json"||name=="deployments.json"||name=="deployments.json.agcu.tmp"||name==Marker||System.Text.RegularExpressions.Regex.IsMatch(name,@"^cu(?:-[a-f0-9]{12})?(?:-node)?\.(?:mjs|exe|cmd)(?:\.agcu\.tmp)?$"))continue;
            return false;
        }
        return true;
    }
    static bool OwnData(string root){
        if(File.Exists(Path.Combine(root,Marker)))return true;
        if(!Directory.Exists(root))return true;
        using(var found=Directory.EnumerateFileSystemEntries(root).GetEnumerator())if(!found.MoveNext())return true;
        bool runtimeEvidence=false,onlyRuntime=true;
        foreach(string path in Directory.EnumerateFileSystemEntries(root)){
            string name=Path.GetFileName(path);
            if(name=="desktop-session.json"||System.Text.RegularExpressions.Regex.IsMatch(name,@"^guard-\d+-[a-f0-9-]+\.state$"))runtimeEvidence=true;
            if(name=="desktop-session.json"||name=="observations"||name=="sessions"||name=="bin"||name=="control-preferences.json"||name=="emergency.stop"||name=="task-state.json"||name=="desktop-receipts.jsonl"||name=="desktop-receipts.jsonl.previous"||System.Text.RegularExpressions.Regex.IsMatch(name,@"^guard-\d+-[a-f0-9-]+\.state(?:\..+)?$"))continue;
            onlyRuntime=false;
        }
        if(runtimeEvidence&&onlyRuntime)return true;
        string parent=Path.GetDirectoryName(root);
        if(Path.GetFileName(root)=="data"&&OwnInstall(parent))return true;
        string package=Path.Combine(parent,"package.json");
        if(Path.GetFileName(root)==".localdata"&&File.Exists(package))try {
            var metadata=new JavaScriptSerializer().DeserializeObject(File.ReadAllText(package)) as Dictionary<string,object>;
            return metadata!=null&&metadata.ContainsKey("name")&&Convert.ToString(metadata["name"])=="antigravity-native-computer-use";
        }catch{}
        return false;
    }
    static string SaveOriginalAcls(string root,List<object> original){
        string audit;
        if(Directory.Exists("D:\\")){
            string suffix;using(var hash=SHA256.Create())suffix=BitConverter.ToString(hash.ComputeHash(Encoding.UTF8.GetBytes(Me.Value))).Replace("-","").ToLowerInvariant().Substring(0,10);
            audit=Path.Combine("D:\\","Apps","AntigravityComputerUse",suffix);
        }else audit=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"AntigravityComputerUse");
        audit=Canonical(audit);Ancestors(audit);
        if(Directory.Exists(audit)){Owner(audit);if(!OwnInstall(audit))Refuse("storage_not_dedicated",audit,"The private audit/installation anchor belongs to unrelated data.");}
        else {
            var missing=new Stack<string>();string next=audit;
            while(!Directory.Exists(next)){missing.Push(next);next=Path.GetDirectoryName(next);}
            while(missing.Count>0)Directory.CreateDirectory(missing.Pop(),DirectoryAcl(true));
        }
        Protect(audit);Verify(audit,true);
        string marker=Path.Combine(audit,Marker);File.WriteAllText(marker,"antigravity-computer-use-private-storage-v1\n",new UTF8Encoding(false));Protect(marker);
        string backups=Path.Combine(audit,"backups");Directory.CreateDirectory(backups,DirectoryAcl(true));Protect(backups);
        string file=Path.Combine(backups,"acl-original-"+DateTime.UtcNow.ToString("yyyyMMddTHHmmssfff")+"-"+System.Diagnostics.Process.GetCurrentProcess().Id+".json");
        var json=new JavaScriptSerializer();json.MaxJsonLength=16*1024*1024;
        File.WriteAllText(file,json.Serialize(new {purpose="original project ACLs for audit; rollback never silently widens permissions",root=root,entries=original}),new UTF8Encoding(false));Protect(file);
        return file;
    }
    public static int Main(string[] args){
        try{Console.OutputEncoding=new UTF8Encoding(false);}catch{}
        Console.OutputEncoding=new UTF8Encoding(false);
        try {
            if(args.Length==1&&args[0]=="identity"){Console.WriteLine(new JavaScriptSerializer().Serialize(new {ok=true,owner_sid=Me.Value}));return 0;}
            if(args.Length!=2)throw new ArgumentException("Pass install/data/legacy/verify/verify-tree/verify-data-tree and one dedicated folder.");
            string mode=args[0],root=Canonical(args[1]);
            if(mode=="lease")return Lease(root);
            if(mode!="install"&&mode!="data"&&mode!="legacy"&&mode!="verify"&&mode!="verify-tree"&&mode!="verify-data-tree")throw new ArgumentException("Unknown storage operation.");
            if(mode=="install"||mode=="verify-tree")Ancestors(root);
            else {string parent=Path.GetDirectoryName(root);while(!String.IsNullOrEmpty(parent)){if(Directory.Exists(parent))NoLink(parent);parent=Path.GetDirectoryName(parent);}}
            bool exists=Directory.Exists(root);
            if(mode=="verify"||mode=="verify-tree"||mode=="verify-data-tree"){
                if(!exists)Refuse("storage_missing",root,"Storage does not exist.");
                var checkedPaths=mode=="verify"?new List<string>{root}:Tree(root);foreach(string path in checkedPaths)Verify(path,path==root);
                Console.WriteLine(new JavaScriptSerializer().Serialize(new {ok=true,private_storage=true,path=root,checked_entries=checkedPaths.Count,owner_sid=Me.Value}));return 0;
            }
            if(exists){
                Owner(root);
                bool nonempty;using(var found=Directory.EnumerateFileSystemEntries(root).GetEnumerator())nonempty=found.MoveNext();
                if((mode=="install"&&nonempty&&!OwnInstall(root))||(mode=="data"&&!OwnData(root))||(mode=="legacy"&&!OwnInstall(root)))Refuse("storage_not_dedicated",root,"Refusing to change permissions of an unrelated nonempty directory.");
            } else if(mode=="legacy")Refuse("storage_missing",root,"Legacy installation is missing.");
            // Validate every existing entry before changing any ACL. Never follow a junction.
            var paths=exists?Tree(root):new List<string>();
            var original=new List<object>();
            if(mode=="legacy")foreach(string path in paths)original.Add(new {path=path==root?".":path.Substring(root.Length+1),sddl=Security(path).GetSecurityDescriptorSddlForm(AccessControlSections.Access|AccessControlSections.Owner|AccessControlSections.Group)});
            string backup=mode=="legacy"?SaveOriginalAcls(root,original):null;
            if(!exists){
                var missing=new Stack<string>();string next=root;
                while(!Directory.Exists(next)){missing.Push(next);next=Path.GetDirectoryName(next);}
                while(missing.Count>0)Directory.CreateDirectory(missing.Pop(),DirectoryAcl(true));
                paths.Add(root);
            }
            foreach(string path in paths)try{Protect(path);}catch(Exception error){Refuse("storage_permissions_failed",path,error.Message+" Original ACL journal: "+backup);}
            File.WriteAllText(Path.Combine(root,Marker),"antigravity-computer-use-private-storage-v1\n",new UTF8Encoding(false));
            Protect(Path.Combine(root,Marker));foreach(string path in paths)Verify(path,path==root);
            Console.WriteLine(new JavaScriptSerializer().Serialize(new {ok=true,private_storage=true,path=root,secured_entries=paths.Count,owner_sid=Me.Value,ancestors_checked=mode=="install",acl_backup=backup}));return 0;
        }catch(Exception error){var refusal=error as Refusal;Console.WriteLine(new JavaScriptSerializer().Serialize(new {ok=false,error=new {code=refusal!=null?refusal.Code:"storage_permissions_failed",path=refusal!=null?refusal.Target:null,message=error.Message}}));return 1;}
    }
}
