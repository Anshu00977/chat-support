import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { io, type Socket } from "socket.io-client";
import { API_URL } from "../api/client";
import { useAuth } from "./AuthContext";

const SocketContext = createContext<Socket | null>(null);

export function SocketProvider({ children }: { children: ReactNode }) {
  const { token } = useAuth();
  const [socket, setSocket] = useState<Socket | null>(null);

  // Socket creation belongs in an effect, not useMemo — useMemo is meant to be
  // pure, but io(...) opens a real network connection. Under React 18 Strict
  // Mode (dev only), render-phase functions are intentionally double-invoked
  // to catch exactly this kind of side effect, which was creating a second,
  // orphaned connection and leaving the app pointed at an inconsistent one.
  useEffect(() => {
    if (!token) {
      setSocket(null);
      return;
    }

    const instance = io(API_URL, { auth: { token }, autoConnect: true });
    setSocket(instance);

    return () => {
      instance.disconnect();
    };
  }, [token]);

  return <SocketContext.Provider value={socket}>{children}</SocketContext.Provider>;
}

export function useSocket() {
  return useContext(SocketContext);
}
