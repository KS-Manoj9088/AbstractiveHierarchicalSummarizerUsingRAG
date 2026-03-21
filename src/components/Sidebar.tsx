import React, { useState, useEffect } from 'react';
import { db } from '../firebase';
import { collection, query, where, orderBy, onSnapshot, addDoc, serverTimestamp, deleteDoc, doc } from 'firebase/firestore';
import { Plus, MessageSquare, Trash2, Search, ChevronLeft, ChevronRight } from 'lucide-react';
import { Chat } from '../types';
import { motion, AnimatePresence } from 'motion/react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export default function Sidebar({ 
  userId, 
  activeChatId, 
  onChatSelect, 
  onNewChat 
}: { 
  userId: string, 
  activeChatId: string | null, 
  onChatSelect: (id: string) => void,
  onNewChat: () => void
}) {
  const [chats, setChats] = useState<Chat[]>([]);
  const [search, setSearch] = useState('');
  const [isCollapsed, setIsCollapsed] = useState(false);

  useEffect(() => {
    if (!userId) return;

    const q = query(
      collection(db, 'chats'),
      where('userId', '==', userId),
      orderBy('updatedAt', 'desc')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const chatList: Chat[] = [];
      snapshot.forEach((doc) => {
        chatList.push({ id: doc.id, ...doc.data() } as Chat);
      });
      setChats(chatList);
    }, (error) => {
      console.error("Sidebar onSnapshot error:", error);
    });

    return () => unsubscribe();
  }, [userId]);

  const handleDeleteChat = async (e: React.MouseEvent, chatId: string) => {
    e.stopPropagation();
    try {
      await deleteDoc(doc(db, 'chats', chatId));
      if (activeChatId === chatId) {
        onNewChat();
      }
    } catch (error) {
      console.error("Error deleting chat:", error);
    }
  };

  const filteredChats = chats.filter(chat => 
    chat.title.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <motion.div 
      animate={{ width: isCollapsed ? 80 : 280 }}
      className="h-screen bg-[#0a0a0a] border-r border-white/10 flex flex-col relative transition-all duration-300"
    >
      <div className="p-4 flex items-center justify-between">
        {!isCollapsed && (
          <h2 className="text-sm font-semibold text-white/40 uppercase tracking-widest">History</h2>
        )}
        <button 
          onClick={() => setIsCollapsed(!isCollapsed)}
          className="p-2 rounded-lg hover:bg-white/5 text-white/40 hover:text-white transition-colors"
        >
          {isCollapsed ? <ChevronRight className="w-5 h-5" /> : <ChevronLeft className="w-5 h-5" />}
        </button>
      </div>

      <div className="px-4 mb-4">
        <button
          onClick={onNewChat}
          className={cn(
            "w-full flex items-center gap-3 px-4 py-3 bg-emerald-500/10 text-emerald-500 font-medium rounded-xl hover:bg-emerald-500/20 transition-all border border-emerald-500/20 active:scale-[0.98]",
            isCollapsed && "justify-center px-0"
          )}
        >
          <Plus className="w-5 h-5" />
          {!isCollapsed && <span>New Summary</span>}
        </button>
      </div>

      {!isCollapsed && (
        <div className="px-4 mb-4 relative">
          <Search className="w-4 h-4 absolute left-7 top-1/2 -translate-y-1/2 text-white/30" />
          <input
            type="text"
            placeholder="Search chats..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-white/5 border border-white/10 rounded-xl py-2 pl-10 pr-4 text-sm text-white focus:outline-none focus:border-emerald-500/50 transition-colors"
          />
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-2 space-y-1 custom-scrollbar">
        <AnimatePresence initial={false}>
          {filteredChats.map((chat) => (
            <motion.div
              key={chat.id}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -10 }}
              onClick={() => onChatSelect(chat.id)}
              className={cn(
                "group flex items-center gap-3 px-3 py-3 rounded-xl cursor-pointer transition-all relative",
                activeChatId === chat.id ? "bg-white/10 text-white" : "text-white/40 hover:bg-white/5 hover:text-white/80",
                isCollapsed && "justify-center"
              )}
            >
              <MessageSquare className="w-5 h-5 flex-shrink-0" />
              {!isCollapsed && (
                <>
                  <span className="flex-1 truncate text-sm font-medium">{chat.title}</span>
                  <button
                    onClick={(e) => handleDeleteChat(e, chat.id)}
                    className="opacity-0 group-hover:opacity-100 p-1 rounded-md hover:bg-red-500/20 text-red-500/60 hover:text-red-500 transition-all"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </>
              )}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}
