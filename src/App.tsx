import React, { useState, useEffect, useCallback, useRef } from 'react';
import { 
  Activity, 
  Server as ServerIcon, 
  Plus, 
  Trash2, 
  LogOut, 
  Moon, 
  Sun, 
  Bell, 
  Globe, 
  AlertCircle,
  Timer,
  BarChart3,
  TrendingUp,
  ExternalLink,
  ChevronRight,
  Settings,
  LayoutDashboard,
  ShieldAlert,
  ChevronDown
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  AreaChart,
  Area as RechartsArea
} from 'recharts';
import { format } from 'date-fns';
import { cn } from './lib/utils';
import { 
  onAuthStateChanged, 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword, 
  signOut,
  GoogleAuthProvider,
  signInWithPopup,
  User as FirebaseUser
} from 'firebase/auth';
import { 
  collection, 
  addDoc, 
  onSnapshot, 
  query, 
  where, 
  getDoc,
  deleteDoc, 
  doc, 
  setDoc,
  orderBy,
  limit,
  serverTimestamp
} from 'firebase/firestore';
import { auth, db } from './lib/firebase';

// --- Types ---
import { Server, PollingResult, Theme } from './types.ts';

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export default function App() {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [servers, setServers] = useState<Server[]>([]);
  const [history, setHistory] = useState<{ [serverId: string]: PollingResult[] }>({});
  const [theme, setTheme] = useState<Theme>('dark');
  const [isAuthMode, setIsAuthMode] = useState<'login' | 'register'>('login');
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [selectedServerId, setSelectedServerId] = useState<string | null>(null);

  // Form State
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [serverName, setServerName] = useState('');
  const [serverUrl, setServerUrl] = useState('');
  const [serverInterval, setServerInterval] = useState(5);
  const [authError, setAuthError] = useState('');

  // Polling intervals ref
  const intervalsRef = useRef<{ [serverId: string]: number }>({});

  // Use refs to avoid stale closures in setInterval
  const userRef = useRef<FirebaseUser | null>(user);
  const serversRef = useRef<Server[]>(servers);

  // --- Auth Observer ---
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setAuthLoading(false);
    });
    return () => unsubscribe();
  }, []);

  // --- Firestore Subscriptions ---
  useEffect(() => {
    if (!user) {
      setServers([]);
      setHistory({});
      return;
    }

    const q = query(collection(db, 'servers'), where('userId', '==', user.uid));
    const unsubscribeServers = onSnapshot(q, (snapshot) => {
      const serverList: Server[] = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Server));
      setServers(serverList);
    }, (err) => handleFirestoreError(err, OperationType.LIST, 'servers'));

    return () => unsubscribeServers();
  }, [user]);

  // Handle individual server history subscriptions
  useEffect(() => {
    const unsubscribes: (() => void)[] = [];
    
    servers.forEach(server => {
      const hq = query(
        collection(db, `servers/${server.id}/history`), 
        where('userId', '==', user.uid),
        orderBy('timestamp', 'desc'),
        limit(50)
      );
      
      const unsubscribe = onSnapshot(hq, (snapshot) => {
        const results = snapshot.docs.map(d => {
          const data = d.data();
          return {
            timestamp: data.timestamp,
            responseTime: data.responseTime,
            status: data.status
          } as PollingResult;
        }).reverse();
        
        setHistory(prev => ({ ...prev, [server.id]: results }));
      }, (err) => handleFirestoreError(err, OperationType.LIST, `servers/${server.id}/history`));
      
      unsubscribes.push(unsubscribe);
    });

    return () => unsubscribes.forEach(u => u());
  }, [servers]);

  useEffect(() => {
    userRef.current = user;
    serversRef.current = servers;
  }, [user, servers]);

  // --- Real-time Polling Engine ---
  const pollServer = useCallback(async (serverId: string) => {
    const server = serversRef.current.find(s => s.id === serverId);
    const currentUser = userRef.current;
    
    if (!server || !currentUser) return;

    const start = performance.now();
    let status: 'online' | 'offline' = 'offline';
    let responseTime = 0;

    try {
      // Using GET as some health Actuators prefer it over HEAD
      await fetch(server.url, { 
        method: 'GET', 
        mode: 'no-cors',
        cache: 'no-cache',
        // Opaque response means we can't see the status code (due to CORS),
        // but if it doesn't throw a network error, the server is reachable.
      });
      status = 'online';
      responseTime = Math.round(performance.now() - start);
    } catch (err) {
      status = 'offline';
      responseTime = 0;
      
      if ('Notification' in window && Notification.permission === 'granted') {
        new Notification(`CRITICAL: ${server.name} Downtime`, {
          body: `Node at ${server.url} is unreachable.`,
          icon: '/favicon.ico'
        });
      }
    }

    try {
      await addDoc(collection(db, `servers/${server.id}/history`), {
        userId: currentUser.uid,
        timestamp: new Date().toISOString(),
        responseTime,
        status,
        createdAt: serverTimestamp()
      });
    } catch (err) {
      // Improved error logging for debugging
      console.error(`Failed to log poll for ${server.name}:`, err);
    }
  }, []); // Truly stable callback

  useEffect(() => {
    if (!user) {
      Object.values(intervalsRef.current).forEach(clearInterval);
      intervalsRef.current = {};
      return;
    }

    // Refresh intervals when servers or user changes
    servers.forEach(server => {
      // If interval doesn't exist, start it
      if (!intervalsRef.current[server.id]) {
        pollServer(server.id);
        const intervalId = window.setInterval(() => {
          pollServer(server.id);
        }, server.interval * 60 * 1000);
        intervalsRef.current[server.id] = intervalId;
      }
    });

    // Cleanup removed servers
    Object.keys(intervalsRef.current).forEach(id => {
      if (!servers.find(s => s.id === id)) {
        clearInterval(intervalsRef.current[id]);
        delete intervalsRef.current[id];
      }
    });
  }, [user, servers, pollServer]);

  // --- Actions ---
  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');
    try {
      if (isAuthMode === 'register') {
        const credential = await createUserWithEmailAndPassword(auth, email, password);
        await ensureUserProfile(credential.user);
      } else {
        await signInWithEmailAndPassword(auth, email, password);
      }
    } catch (err: any) {
      setAuthError(err.message);
    }
  };

  const handleGoogleAuth = async () => {
    setAuthError('');
    try {
      const provider = new GoogleAuthProvider();
      const credential = await signInWithPopup(auth, provider);
      await ensureUserProfile(credential.user);
    } catch (err: any) {
      if (err.code !== 'auth/popup-closed-by-user') {
        setAuthError(err.message);
      }
    }
  };

  const ensureUserProfile = async (u: FirebaseUser) => {
    const userRef = doc(db, 'users', u.uid);
    const userDoc = await getDoc(userRef);
    if (!userDoc.exists()) {
      await setDoc(userRef, {
        email: u.email,
        createdAt: new Date().toISOString()
      });
    }
  };

  const handleLogout = () => signOut(auth);

  const addServer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    
    try {
      const url = serverUrl.startsWith('http') ? serverUrl : `https://${serverUrl}`;
      await addDoc(collection(db, 'servers'), {
        userId: user.uid,
        name: serverName,
        url,
        interval: Number(serverInterval),
        createdAt: new Date().toISOString()
      });
      setServerName('');
      setServerUrl('');
      setServerInterval(5);
      setIsAddModalOpen(false);
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'servers');
    }
  };

  const deleteServer = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'servers', id));
      if (selectedServerId === id) setSelectedServerId(null);
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `servers/${id}`);
    }
  };

  const getServerStats = (serverId: string) => {
    const data = history[serverId] || [];
    const onlineCount = data.filter(d => d.status === 'online').length;
    const uptime = data.length > 0 ? (onlineCount / data.length) * 100 : 0;
    const avgResponseTime = onlineCount > 0 
      ? data.filter(d => d.status === 'online').reduce((acc, curr) => acc + curr.responseTime, 0) / onlineCount 
      : 0;
    
    return { uptime, avgResponseTime };
  };

  if (authLoading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <Activity size={48} className="text-indigo-500 animate-spin" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950 p-4 font-sans text-slate-200">
        <motion.div 
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="w-full max-w-md bg-slate-900 p-10 rounded-[2rem] border border-slate-800 shadow-2xl"
        >
          <div className="flex flex-col items-center mb-10">
            <div className="w-20 h-20 bg-indigo-600/10 rounded-3xl flex items-center justify-center text-indigo-500 mb-6 border border-indigo-500/20">
              <Activity size={40} />
            </div>
            <h1 className="text-4xl font-black tracking-tight text-white mb-2">Server Watcher</h1>
            <p className="text-slate-400 text-center font-medium">Global infrastructure observability.</p>
          </div>

          <form onSubmit={handleAuth} className="space-y-6">
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500 mb-2">Access Portal Email</label>
              <input 
                type="email" required value={email} onChange={e => setEmail(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-2xl px-6 py-4 text-white focus:outline-none focus:border-indigo-500 transition-all font-medium"
                placeholder="operator@nexus.io"
              />
            </div>
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500 mb-2">Encrypted Entry Key</label>
              <input 
                type="password" required value={password} onChange={e => setPassword(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-2xl px-6 py-4 text-white focus:outline-none focus:border-indigo-500 transition-all font-medium"
                placeholder="••••••••"
              />
            </div>

            {authError && <p className="text-rose-500 text-xs font-bold bg-rose-500/10 p-3 rounded-xl border border-rose-500/20">{authError}</p>}

            <button 
              type="submit"
              className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-5 rounded-2xl transition-all shadow-xl shadow-indigo-600/20"
            >
              {isAuthMode === 'login' ? 'Establish Connection' : 'Initialize Identity'}
            </button>

            <div className="relative py-4">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-slate-800"></div>
              </div>
              <div className="relative flex justify-center text-[10px] font-bold uppercase tracking-widest">
                <span className="bg-slate-900 px-4 text-slate-500">Or Secure OAuth</span>
              </div>
            </div>

            <button 
              type="button"
              onClick={handleGoogleAuth}
              className="w-full bg-slate-950 hover:bg-slate-800 border border-slate-800 text-white font-bold py-4 rounded-2xl transition-all flex items-center justify-center gap-3"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24">
                <path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                <path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                <path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                <path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
              </svg>
              Sign in with Google
            </button>
          </form>

          <div className="mt-8 text-center">
            <button 
              onClick={() => setIsAuthMode(isAuthMode === 'login' ? 'register' : 'login')}
              className="text-xs font-bold text-slate-500 hover:text-indigo-400 transition-colors uppercase tracking-widest"
            >
              {isAuthMode === 'login' ? "Zero identity? Register New Node" : "Existing Identity? Authenticate"}
            </button>
          </div>
        </motion.div>
      </div>
    );
  }

  const selectedServer = servers.find(s => s.id === selectedServerId);
  const selectedHistory = selectedServerId ? history[selectedServerId] || [] : [];
  const overallUptime = servers.length > 0 
    ? servers.reduce((acc, s) => acc + getServerStats(s.id).uptime, 0) / servers.length 
    : 100;
  const avgGlobalLatency = servers.length > 0
    ? servers.reduce((acc, s) => acc + getServerStats(s.id).avgResponseTime, 0) / servers.length
    : 0;

  return (
    <div className="flex h-screen bg-slate-950 text-slate-200 font-sans overflow-hidden">
      {/* Sidebar - Geometric Rail */}
      <aside className="w-24 bg-slate-900 border-r border-slate-800 flex flex-col items-center py-10 justify-between shrink-0">
        <div className="flex flex-col items-center gap-12">
          <div className="w-12 h-12 bg-indigo-600 rounded-2xl flex items-center justify-center shadow-lg shadow-indigo-600/20 text-white">
            <Activity size={28} />
          </div>
          
          <nav className="flex flex-col gap-8">
            <div className="p-3 bg-slate-800 text-indigo-400 rounded-xl cursor-pointer shadow-inner">
              <LayoutDashboard size={24} />
            </div>
            {/* <div className="p-3 text-slate-500 hover:text-slate-300 transition-colors cursor-pointer">
              <Globe size={24} />
            </div>
            <div className="p-3 text-slate-500 hover:text-slate-300 transition-colors cursor-pointer">
              <Settings size={24} />
            </div> */}
          </nav>
        </div>

        <div className="flex flex-col items-center gap-8">
          {/* <button 
            onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
            className="text-slate-500 hover:text-indigo-400 p-2 transition-colors"
          >
            {theme === 'dark' ? <Sun size={24} /> : <Moon size={24} />}
          </button> */}
          <button onClick={handleLogout} className="text-slate-500 hover:text-rose-500 transition-colors">
            <LogOut size={24} />
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col relative overflow-hidden">
        
        {/* Top Header Bar */}
        <header className="px-10 py-8 flex justify-between items-end shrink-0">
          <div>
            <h1 className="text-4xl font-black tracking-tighter text-white">Pulse Center</h1>
            <p className="text-slate-500 font-medium mt-1 uppercase tracking-[0.3em] text-[10px]">
              Monitoring {servers.length} Production Clusters
            </p>
          </div>
          
          <div className="flex items-center gap-10">
            <div className="text-right">
              <span className="text-[10px] font-bold uppercase tracking-widest text-slate-600 block mb-1">Global Performance</span>
              <div className="flex items-center justify-end gap-3">
                <span className="text-2xl font-mono font-bold text-emerald-400 tracking-tighter">{overallUptime.toFixed(2)}%</span>
                <span className="text-2xl font-mono font-bold text-indigo-400 tracking-tighter">{avgGlobalLatency.toFixed(0)}<span className="text-xs uppercase ml-1">ms</span></span>
              </div>
            </div>
            <div className="h-12 w-px bg-slate-800"></div>
            <button 
              onClick={() => setIsAddModalOpen(true)}
              className="bg-indigo-600 hover:bg-indigo-500 text-white font-bold px-8 py-3 rounded-xl shadow-2xl shadow-indigo-600/20 transition-all flex items-center gap-2"
            >
              <Plus size={20} />
              Provision Node
            </button>
          </div>
        </header>

        {/* Content Region */}
        <div className="flex-1 px-10 pb-10 overflow-hidden flex flex-col gap-8">
          
          <div className="grid grid-cols-12 gap-8 flex-1 overflow-hidden">
            
            {/* Left: Interactive Monitor Registry */}
            <div className="col-span-12 lg:col-span-8 bg-slate-900 border border-slate-800 rounded-3xl flex flex-col overflow-hidden shadow-2xl relative">
               <div className="p-8 border-b border-slate-800 flex justify-between items-center shrink-0">
                  <h3 className="text-xl font-bold flex items-center gap-3">
                    <Activity size={20} className="text-indigo-500" />
                    Infrastructure Registry
                  </h3>
                  <div className="flex items-center gap-2 px-4 py-2 bg-slate-950 rounded-xl border border-slate-800 text-[10px] font-bold uppercase text-slate-500 tracking-widest">
                    <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></div>
                    Real-time Active
                  </div>
               </div>

               <div className="flex-1 overflow-auto scrollbar-hide">
                  <table className="w-full text-left border-collapse">
                    <thead className="sticky top-0 bg-slate-900 z-10">
                      <tr className="text-slate-600 text-[10px] font-black uppercase tracking-[0.2em] border-b border-slate-800">
                        <th className="px-8 py-5">Node Identity</th>
                        <th className="px-8 py-5">Endpoint Target</th>
                        <th className="px-8 py-5">Uptime</th>
                        <th className="px-8 py-5">Latency</th>
                        <th className="px-8 py-5">Control</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/50">
                      {servers.map(server => {
                        const { uptime, avgResponseTime } = getServerStats(server.id);
                        const lastStatus = history[server.id]?.slice(-1)[0]?.status || 'offline';
                        
                        return (
                          <motion.tr 
                            key={server.id}
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            onClick={() => setSelectedServerId(server.id)}
                            className={cn(
                              "group transition-all cursor-pointer relative",
                              selectedServerId === server.id ? "bg-indigo-600/5" : "hover:bg-slate-800/30"
                            )}
                          >
                            <td className="px-8 py-6">
                              <div className="flex items-center gap-4">
                                <div className={cn(
                                  "w-3 h-3 rounded-sm rotate-45 shrink-0",
                                  lastStatus === 'online' ? "bg-emerald-500" : "bg-rose-500"
                                )}></div>
                                <span className={cn("font-bold text-lg", selectedServerId === server.id ? "text-indigo-400" : "text-slate-200")}>
                                  {server.name}
                                </span>
                              </div>
                            </td>
                            <td className="px-8 py-6 font-mono text-[10px] text-slate-500">{server.url}</td>
                            <td className="px-8 py-6">
                              <span className={cn("font-bold", uptime > 99 ? "text-emerald-400" : "text-rose-500")}>
                                {uptime.toFixed(1)}%
                              </span>
                            </td>
                            <td className="px-8 py-6 text-indigo-400 font-bold tabular-nums">
                              {avgResponseTime.toFixed(0)}<span className="text-[10px] ml-1 opacity-60">MS</span>
                            </td>
                            <td className="px-8 py-6">
                              <div className="flex items-center gap-3">
                                <button 
                                  onClick={(e) => { e.stopPropagation(); deleteServer(server.id); }}
                                  className="p-2 text-slate-600 hover:text-rose-500 transition-colors opacity-0 group-hover:opacity-100"
                                >
                                  <Trash2 size={16} />
                                </button>
                                <ChevronRight size={18} className="text-slate-700" />
                              </div>
                            </td>
                          </motion.tr>
                        );
                      })}
                      {servers.length === 0 && (
                        <tr>
                          <td colSpan={5} className="py-32 text-center text-slate-600">
                             <div className="flex flex-col items-center gap-4">
                               <ServerIcon size={48} className="opacity-20" />
                               <p className="font-bold tracking-widest uppercase text-sm">Node registry is currently empty</p>
                             </div>
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
               </div>
            </div>

            {/* Right: Telemetry Details */}
            <div className="col-span-12 lg:col-span-4 flex flex-col gap-8 overflow-hidden">
               
               {/* Selected Node Details */}
               <AnimatePresence mode="wait">
                 {selectedServer ? (
                   <motion.div 
                    key={selectedServer.id}
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 20 }}
                    className="bg-slate-900 border border-slate-800 rounded-3xl p-8 shadow-2xl flex flex-col h-full overflow-hidden"
                   >
                      <div className="flex justify-between items-start mb-10 shrink-0">
                        <div className="min-w-0">
                          <h2 className="text-2xl font-black text-white leading-none truncate">{selectedServer.name}</h2>
                          <div className="flex items-center gap-2 mt-3 text-[10px] font-bold text-slate-500 uppercase tracking-widest">
                            <Timer size={12} className="text-indigo-500" />
                            Interval: {selectedServer.interval}min
                          </div>
                        </div>
                        <a href={selectedServer.url} target="_blank" rel="noreferrer" className="p-3 bg-slate-950 text-slate-500 hover:text-indigo-400 rounded-xl transition-all border border-slate-800 shrink-0">
                          <ExternalLink size={20} />
                        </a>
                      </div>

                      <div className="flex-1 min-h-[200px] mb-8">
                         <ResponsiveContainer width="100%" height="100%">
                           <AreaChart data={selectedHistory.map(h => ({ x: format(new Date(h.timestamp), 'HH:mm'), y: h.responseTime }))}>
                              <defs>
                                <linearGradient id="latencyGradient" x1="0" y1="0" x2="0" y2="1">
                                  <stop offset="5%" stopColor="#6366f1" stopOpacity={0.4}/>
                                  <stop offset="95%" stopColor="#6366f1" stopOpacity={0}/>
                                </linearGradient>
                              </defs>
                              <Tooltip 
                                contentStyle={{ backgroundColor: '#0f172a', border: '1px solid #1e293b', borderRadius: '12px' }}
                                itemStyle={{ color: '#818cf8', fontWeight: 'bold' }}
                                labelStyle={{ color: '#475569', fontSize: '10px', textTransform: 'uppercase' }}
                              />
                              <RechartsArea 
                                type="stepBefore" 
                                dataKey="y" 
                                stroke="#6366f1" 
                                strokeWidth={3}
                                fill="url(#latencyGradient)"
                                animationDuration={800}
                              />
                           </AreaChart>
                         </ResponsiveContainer>
                      </div>

                      <div className="grid grid-cols-2 gap-4 mt-auto shrink-0">
                         <div className="bg-slate-950 p-6 rounded-2xl border border-slate-800/50">
                           <span className="text-[10px] font-bold text-slate-600 block mb-2 uppercase tracking-widest">Peak Load</span>
                           <span className="text-xl font-mono font-bold text-indigo-400">
                             {selectedHistory.length > 0 ? Math.max(...selectedHistory.map(h => h.responseTime)) : 0}ms
                           </span>
                         </div>
                         <div className="bg-slate-950 p-6 rounded-2xl border border-slate-800/50">
                           <span className="text-[10px] font-bold text-slate-600 block mb-2 uppercase tracking-widest">Stability</span>
                           <span className="text-xl font-mono font-bold text-emerald-400">
                             {getServerStats(selectedServer.id).uptime.toFixed(1)}%
                           </span>
                         </div>
                      </div>
                   </motion.div>
                 ) : (
                   <div className="bg-slate-950/50 border-2 border-dashed border-slate-800 rounded-3xl p-10 flex flex-col items-center justify-center text-center h-full">
                      <BarChart3 size={64} className="text-slate-800 mb-6" />
                      <h4 className="text-lg font-bold text-slate-700 capitalize">Telemetry Stream Offline</h4>
                      <p className="text-slate-800 text-sm mt-2 font-medium">Select a node from the registry to initialize telemetry visualize.</p>
                   </div>
                 )}
               </AnimatePresence>

               {/* Incident Monitor */}
               <div className="bg-slate-900 border border-slate-800 rounded-3xl p-8 h-fit shrink-0 overflow-hidden">
                  <div className="flex justify-between items-center mb-6">
                    <h3 className="font-bold flex items-center gap-2 text-white">
                       <ShieldAlert size={18} className="text-rose-500" />
                       Incident Log
                    </h3>
                    <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Last 24H</span>
                  </div>
                  <div className="space-y-4 max-h-[200px] overflow-auto scrollbar-hide">
                    {servers.map(s => {
                      const stats = getServerStats(s.id);
                      if (stats.uptime < 100) {
                        return (
                          <div key={s.id} className="flex items-start gap-4 p-4 bg-slate-950 rounded-2xl border border-rose-500/10">
                            <div className="w-2 h-2 rounded-full bg-rose-500 mt-1.5 shrink-0 shadow-lg shadow-rose-500/20"></div>
                            <div>
                               <p className="text-sm font-bold text-slate-300">{s.name} Incident</p>
                               <p className="text-[10px] text-slate-500 font-medium uppercase tracking-wider mt-1">Downtime detected ({100 - stats.uptime < 0.1 ? 'Sub-second' : (100-stats.uptime).toFixed(1) + '% loss'})</p>
                            </div>
                          </div>
                        );
                      }
                      return null;
                    })}
                    {overallUptime === 100 && (
                      <div className="py-6 text-center text-slate-700 italic text-sm font-medium">
                        No critical telemetry anomalies detected.
                      </div>
                    )}
                  </div>
               </div>

            </div>
          </div>
        </div>

        {/* Global Footer Stats Bar */}
        <footer className="h-16 border-t border-slate-800 bg-slate-900/50 backdrop-blur px-10 flex items-center justify-between shrink-0">
           <div className="flex gap-10">
             <div className="flex items-center gap-2">
               <span className="text-[10px] font-bold text-slate-600 uppercase tracking-widest">Network Cluster:</span>
               <span className="text-[10px] font-mono text-indigo-400 font-bold uppercase">PROD-PRIMARY-01</span>
             </div>
             <div className="flex items-center gap-2 text-emerald-500">
               <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></div>
               <span className="text-[10px] font-bold uppercase tracking-[0.2em]">All Systems Nominal</span>
             </div>
           </div>
           <div className="text-[10px] font-bold text-slate-700 uppercase tracking-[0.4em]">
              Pulse Infrastructure OS v4.2 // Node Sandbox
           </div>
        </footer>
      </main>

      {/* Add Node Modal */}
      <AnimatePresence>
        {isAddModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsAddModalOpen(false)}
              className="absolute inset-0 bg-slate-950/80 backdrop-blur-md"
            />
            <motion.div 
              initial={{ opacity: 0, y: 100 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 100 }}
              className="relative w-full max-w-2xl bg-slate-900 rounded-[3rem] shadow-3xl p-12 border border-blue-500/20"
            >
              <h2 className="text-4xl font-black text-white mb-3">Provision New Proxy</h2>
              <p className="text-slate-500 font-medium mb-10">Inject a new node into the monitoring cluster matrix.</p>
              
              <form onSubmit={addServer} className="space-y-8">
                <div className="grid grid-cols-2 gap-8">
                  <div>
                    <label className="block text-[10px] font-bold text-slate-600 uppercase tracking-[0.3em] mb-3">Project Designator</label>
                    <input 
                      type="text" required placeholder="NEXUS-ALPHA" value={serverName}
                      onChange={e => setServerName(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded-2xl px-6 py-4 text-white focus:outline-none focus:border-indigo-500 transition-all font-bold"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-600 uppercase tracking-[0.3em] mb-3">Target Endpoint</label>
                    <input 
                      type="text" required placeholder="api.nexus.io" value={serverUrl}
                      onChange={e => setServerUrl(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded-2xl px-6 py-4 text-white focus:outline-none focus:border-indigo-500 transition-all font-bold"
                    />
                  </div>
                </div>
                
                <div>
                  <label className="block text-[10px] font-bold text-slate-600 uppercase tracking-[0.3em] mb-3">Telemetry Frequency</label>
                  <div className="flex gap-4">
                    <select 
                      value={serverInterval}
                      onChange={e => setServerInterval(Number(e.target.value))}
                      className="flex-1 bg-slate-950 border border-slate-800 rounded-2xl px-6 py-4 text-white focus:outline-none focus:border-indigo-500 appearance-none font-bold"
                    >
                      <option value={1}>1 MINUTE (HIGH ENERGY)</option>
                      <option value={5}>5 MINUTES (STANDARD)</option>
                      <option value={15}>15 MINUTES (CONSERVATIVE)</option>
                      <option value={60}>60 MINUTES (STANDBY)</option>
                    </select>
                    <div className="w-16 h-16 bg-slate-950 rounded-2xl flex items-center justify-center text-indigo-500 border border-slate-800 shrink-0">
                      <Timer size={32} />
                    </div>
                  </div>
                </div>

                <div className="flex gap-6 items-center pt-6">
                   <button 
                    type="button"
                    onClick={() => setIsAddModalOpen(false)}
                    className="flex-1 text-slate-500 font-black uppercase tracking-widest text-xs hover:text-white transition-colors"
                  >
                    Cancel Operations
                  </button>
                  <button 
                    type="submit"
                    className="flex-[2] bg-indigo-600 hover:bg-indigo-500 text-white font-black py-5 rounded-2xl shadow-2xl shadow-indigo-600/30 transition-all uppercase tracking-widest text-sm"
                  >
                   Authorize Node Injection
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
