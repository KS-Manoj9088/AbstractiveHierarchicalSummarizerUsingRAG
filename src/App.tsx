import React, { useState, useEffect } from 'react';
import { auth } from './firebase';
import { onAuthStateChanged, User } from 'firebase/auth';
import Auth from './components/Auth';
import Sidebar from './components/Sidebar';
import Chat from './components/Chat';
import { Loader2 } from 'lucide-react';

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setUser(user);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  if (loading) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-[#0a0a0a]">
        <Loader2 className="w-8 h-8 text-emerald-500 animate-spin" />
      </div>
    );
  }

  if (!user) {
    return <Auth user={null} onSignOut={() => {}} />;
  }

  return (
    <div className="flex h-screen bg-[#0a0a0a] overflow-hidden">
      <Sidebar 
        userId={user.uid} 
        activeChatId={activeChatId} 
        onChatSelect={setActiveChatId}
        onNewChat={() => setActiveChatId(null)}
      />
      <div className="flex-1 flex flex-col min-w-0">
        <Chat 
          userId={user.uid} 
          chatId={activeChatId} 
          onChatCreated={setActiveChatId}
        />
        <Auth user={user} onSignOut={() => setActiveChatId(null)} />
      </div>
    </div>
  );
}
