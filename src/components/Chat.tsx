import React, { useState, useEffect, useRef } from 'react';
import { db } from '../firebase';
import { collection, query, orderBy, onSnapshot, addDoc, serverTimestamp, doc, updateDoc, setDoc } from 'firebase/firestore';
import { Send, Paperclip, FileText, Image as ImageIcon, X, Loader2, Bot, User } from 'lucide-react';
import { Message, Attachment, OperationType } from '../types';
import { generateSummary, generateTitle, handleFirestoreError } from '../services/geminiService';
import { processPdf } from '../utils/pdfUtils';
import Markdown from 'react-markdown';
import { motion, AnimatePresence } from 'motion/react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export default function Chat({ 
  userId, 
  chatId, 
  onChatCreated 
}: { 
  userId: string, 
  chatId: string | null,
  onChatCreated: (id: string) => void
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!chatId) {
      setMessages([]);
      return;
    }

    const q = query(
      collection(db, 'chats', chatId, 'messages'),
      orderBy('timestamp', 'asc')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const messageList: Message[] = [];
      snapshot.forEach((doc) => {
        messageList.push({ id: doc.id, ...doc.data() } as Message);
      });
      setMessages(messageList);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, `chats/${chatId}/messages`);
    });

    return () => unsubscribe();
  }, [chatId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    setIsLoading(true);
    for (const file of Array.from(files)) {
      if (file.type === 'application/pdf') {
        try {
          const { text, previewDataUrl } = await processPdf(file);
          setAttachments(prev => [...prev, {
            name: file.name,
            type: file.type,
            data: text,
            previewDataUrl,
            isRawText: true
          }]);
        } catch (error) {
          console.error("Error processing PDF:", error);
          alert("Failed to process PDF file.");
        }
      } else {
        const reader = new FileReader();
        reader.onload = (event) => {
          const base64 = event.target?.result as string;
          const data = base64.split(',')[1];
          setAttachments(prev => [...prev, {
            name: file.name,
            type: file.type,
            data: data
          }]);
        };
        reader.readAsDataURL(file);
      }
    }
    setIsLoading(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removeAttachment = (index: number) => {
    setAttachments(prev => prev.filter((_, i) => i !== index));
  };

  const handleSendMessage = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if ((!input.trim() && attachments.length === 0) || isLoading) return;

    setIsLoading(true);
    let currentChatId = chatId;

    try {
      // 1. Create chat if it doesn't exist
      if (!currentChatId) {
        const title = attachments.length > 0 ? `Summary: ${attachments[0].name}` : await generateTitle(input);
        const chatRef = await addDoc(collection(db, 'chats'), {
          userId,
          title,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        currentChatId = chatRef.id;
        onChatCreated(currentChatId);
      }

      // 2. Save user message
      const userMessageData = {
        chatId: currentChatId,
        role: 'user',
        content: input,
        timestamp: serverTimestamp(),
        // Strip base64 data before saving to Firestore to avoid 1MB limit
        attachments: attachments.length > 0 ? attachments.map(({ name, type, previewDataUrl }) => ({ name, type, previewDataUrl: previewDataUrl || null })) : null
      };
      
      try {
        await addDoc(collection(db, 'chats', currentChatId, 'messages'), userMessageData);
      } catch (error) {
        handleFirestoreError(error, OperationType.WRITE, `chats/${currentChatId}/messages`);
      }

      const currentInput = input;
      const currentAttachments = [...attachments]; // Keep full attachments for Gemini
      setInput('');
      setAttachments([]);

      // 3. Generate Summary
      const summary = await generateSummary(currentInput, currentAttachments);

      // 4. Save model message
      try {
        await addDoc(collection(db, 'chats', currentChatId, 'messages'), {
          chatId: currentChatId,
          role: 'model',
          content: summary,
          timestamp: serverTimestamp()
        });
      } catch (error) {
        handleFirestoreError(error, OperationType.WRITE, `chats/${currentChatId}/messages`);
      }

      // 5. Update chat timestamp
      try {
        await updateDoc(doc(db, 'chats', currentChatId), {
          updatedAt: serverTimestamp()
        });
      } catch (error) {
        handleFirestoreError(error, OperationType.UPDATE, `chats/${currentChatId}`);
      }

    } catch (error) {
      console.error("Error sending message:", error);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col bg-[#0a0a0a] relative overflow-hidden">
      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto p-6 space-y-8 custom-scrollbar">
        {messages.length === 0 && !isLoading && (
          <div className="h-full flex flex-col items-center justify-center text-center max-w-2xl mx-auto">
            <div className="w-20 h-20 bg-emerald-500/10 rounded-3xl flex items-center justify-center mb-6 border border-emerald-500/20">
              <Bot className="w-10 h-10 text-emerald-500" />
            </div>
            <h2 className="text-3xl font-bold text-white mb-4">Hierarchical Summarizer</h2>
            <p className="text-white/40 text-lg leading-relaxed">
              Upload long documents (PDFs, Images) or paste long texts. 
              I'll provide precise, hierarchical summaries including visual analysis of graphs and illustrations.
            </p>
            <div className="grid grid-cols-2 gap-4 mt-12 w-full">
              <div className="p-4 rounded-2xl bg-white/5 border border-white/10 text-left">
                <FileText className="w-5 h-5 text-emerald-500 mb-2" />
                <p className="text-sm text-white/60">Precise OCR & visual analysis of graphs.</p>
              </div>
              <div className="p-4 rounded-2xl bg-white/5 border border-white/10 text-left">
                <Bot className="w-5 h-5 text-emerald-500 mb-2" />
                <p className="text-sm text-white/60">Hierarchical Map-Reduce summarization.</p>
              </div>
            </div>
          </div>
        )}

        {messages.map((msg) => (
          <motion.div
            key={msg.id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className={cn(
              "flex gap-4 max-w-4xl mx-auto",
              msg.role === 'user' ? "flex-row-reverse" : "flex-row"
            )}
          >
            <div className={cn(
              "w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 border",
              msg.role === 'user' ? "bg-white/5 border-white/10" : "bg-emerald-500/10 border-emerald-500/20"
            )}>
              {msg.role === 'user' ? <User className="w-5 h-5 text-white/60" /> : <Bot className="w-5 h-5 text-emerald-500" />}
            </div>
            
            <div className={cn(
              "flex-1 space-y-4",
              msg.role === 'user' ? "text-right" : "text-left"
            )}>
              {msg.attachments && msg.attachments.length > 0 && (
                <div className={cn("flex flex-wrap gap-2 mb-2", msg.role === 'user' ? "justify-end" : "justify-start")}>
                  {msg.attachments.map((att, i) => (
                    <div key={i} className="flex items-center gap-2 px-3 py-1.5 bg-white/5 border border-white/10 rounded-lg text-xs text-white/60">
                      {att.previewDataUrl ? (
                        <img src={att.previewDataUrl} alt="PDF preview" className="w-4 h-4 object-cover rounded-sm" referrerPolicy="no-referrer" />
                      ) : att.type.startsWith('image/') ? (
                        <ImageIcon className="w-3 h-3" />
                      ) : (
                        <FileText className="w-3 h-3" />
                      )}
                      {att.name}
                    </div>
                  ))}
                </div>
              )}
              <div className={cn(
                "prose prose-invert max-w-none text-white/90 leading-relaxed",
                msg.role === 'user' ? "bg-white/5 p-4 rounded-2xl inline-block" : ""
              )}>
                <Markdown>{msg.content}</Markdown>
              </div>
            </div>
          </motion.div>
        ))}
        
        {isLoading && (
          <div className="flex gap-4 max-w-4xl mx-auto">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center flex-shrink-0">
              <Loader2 className="w-5 h-5 text-emerald-500 animate-spin" />
            </div>
            <div className="flex-1 py-2">
              <div className="flex gap-1">
                <motion.div animate={{ opacity: [0.4, 1, 0.4] }} transition={{ repeat: Infinity, duration: 1.5 }} className="w-2 h-2 bg-emerald-500/40 rounded-full" />
                <motion.div animate={{ opacity: [0.4, 1, 0.4] }} transition={{ repeat: Infinity, duration: 1.5, delay: 0.2 }} className="w-2 h-2 bg-emerald-500/40 rounded-full" />
                <motion.div animate={{ opacity: [0.4, 1, 0.4] }} transition={{ repeat: Infinity, duration: 1.5, delay: 0.4 }} className="w-2 h-2 bg-emerald-500/40 rounded-full" />
              </div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Area */}
      <div className="p-6 border-t border-white/10 bg-[#0a0a0a]/80 backdrop-blur-xl">
        <div className="max-w-4xl mx-auto space-y-4">
          {/* Attachment Previews */}
          <AnimatePresence>
            {attachments.length > 0 && (
              <motion.div 
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 10 }}
                className="flex flex-wrap gap-2"
              >
                {attachments.map((att, i) => (
                  <div key={i} className="group relative flex items-center gap-2 px-3 py-2 bg-white/5 border border-white/10 rounded-xl text-sm text-white/80">
                    {att.previewDataUrl ? (
                      <img src={att.previewDataUrl} alt="PDF preview" className="w-6 h-6 object-cover rounded" referrerPolicy="no-referrer" />
                    ) : att.type.startsWith('image/') ? (
                      <img src={`data:${att.type};base64,${att.data}`} alt="preview" className="w-6 h-6 object-cover rounded" referrerPolicy="no-referrer" />
                    ) : (
                      <FileText className="w-4 h-4 text-emerald-500" />
                    )}
                    <span className="max-w-[150px] truncate">{att.name}</span>
                    <button 
                      onClick={() => removeAttachment(i)}
                      className="p-1 rounded-full hover:bg-white/10 text-white/40 hover:text-white transition-colors"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </motion.div>
            )}
          </AnimatePresence>

          <form onSubmit={handleSendMessage} className="relative flex items-end gap-2">
            <div className="flex-1 relative bg-white/5 border border-white/10 rounded-2xl focus-within:border-emerald-500/50 transition-all overflow-hidden">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSendMessage();
                  }
                }}
                placeholder="Paste long text or upload document..."
                className="w-full bg-transparent border-none p-4 pb-12 text-white placeholder:text-white/20 focus:ring-0 resize-none min-h-[60px] max-h-[300px] custom-scrollbar"
                rows={1}
              />
              <div className="absolute left-2 bottom-2 flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="p-2 rounded-xl hover:bg-white/10 text-white/40 hover:text-white transition-all"
                  title="Upload Document"
                >
                  <Paperclip className="w-5 h-5" />
                </button>
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleFileUpload}
                  multiple
                  className="hidden"
                  accept=".pdf,image/*,.txt"
                />
              </div>
              <div className="absolute right-2 bottom-2">
                <button
                  type="submit"
                  disabled={(!input.trim() && attachments.length === 0) || isLoading}
                  className="p-2 rounded-xl bg-white text-black hover:bg-white/90 disabled:bg-white/10 disabled:text-white/20 transition-all active:scale-95"
                >
                  <Send className="w-5 h-5" />
                </button>
              </div>
            </div>
          </form>
          <p className="text-[10px] text-center text-white/20 uppercase tracking-widest">
            Gemini 3.1 Pro • Hierarchical Summarization • Multimodal RAG
          </p>
        </div>
      </div>
    </div>
  );
}
