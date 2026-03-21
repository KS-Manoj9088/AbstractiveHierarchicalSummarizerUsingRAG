import React from 'react';
import { auth, db } from '../firebase';
import { signInWithPopup, GoogleAuthProvider, signOut } from 'firebase/auth';
import { doc, setDoc, getDoc, serverTimestamp } from 'firebase/firestore';
import { LogIn, LogOut, User } from 'lucide-react';
import { motion } from 'motion/react';

export default function Auth({ user, onSignOut }: { user: any, onSignOut: () => void }) {
  const handleSignIn = async () => {
    const provider = new GoogleAuthProvider();
    try {
      const result = await signInWithPopup(auth, provider);
      const user = result.user;
      
      // Save user profile to Firestore
      const userRef = doc(db, 'users', user.uid);
      const userDoc = await getDoc(userRef);
      
      if (!userDoc.exists()) {
        await setDoc(userRef, {
          uid: user.uid,
          email: user.email,
          displayName: user.displayName,
          photoURL: user.photoURL,
          createdAt: serverTimestamp(),
        });
      }
    } catch (error: any) {
      if (error.code === 'auth/popup-blocked') {
        alert("Sign-in popup was blocked by your browser. Please allow popups for this site.");
      } else if (error.code === 'auth/cancelled-popup-request') {
        console.log("Sign-in popup was closed before completion.");
      } else {
        console.error("Sign-in error:", error);
      }
    }
  };

  const handleSignOut = async () => {
    await signOut(auth);
    onSignOut();
  };

  if (user) {
    return (
      <div className="flex items-center gap-3 p-4 border-t border-white/10 mt-auto">
        <div className="w-10 h-10 rounded-full bg-white/5 flex items-center justify-center overflow-hidden border border-white/10">
          {user.photoURL ? (
            <img src={user.photoURL} alt={user.displayName || 'User'} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
          ) : (
            <User className="w-5 h-5 text-white/40" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-white truncate">{user.displayName || 'User'}</p>
          <p className="text-xs text-white/40 truncate">{user.email}</p>
        </div>
        <button
          onClick={handleSignOut}
          className="p-2 rounded-lg hover:bg-white/5 transition-colors text-white/40 hover:text-white"
          title="Sign Out"
        >
          <LogOut className="w-5 h-5" />
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-[#0a0a0a] p-6">
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md p-8 rounded-2xl bg-white/5 border border-white/10 shadow-2xl text-center"
      >
        <div className="w-16 h-16 bg-emerald-500/20 rounded-2xl flex items-center justify-center mx-auto mb-6 border border-emerald-500/20">
          <LogIn className="w-8 h-8 text-emerald-500" />
        </div>
        <h1 className="text-2xl font-bold text-white mb-2">Welcome Back</h1>
        <p className="text-white/60 mb-8">Sign in to access your hierarchical summarization history.</p>
        
        <button
          onClick={handleSignIn}
          className="w-full flex items-center justify-center gap-3 px-6 py-3 bg-white text-black font-semibold rounded-xl hover:bg-white/90 transition-all active:scale-[0.98]"
        >
          <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="Google" className="w-5 h-5" />
          Continue with Google
        </button>
        
        <p className="mt-6 text-xs text-white/30">
          By continuing, you agree to our Terms of Service and Privacy Policy.
        </p>
      </motion.div>
    </div>
  );
}
