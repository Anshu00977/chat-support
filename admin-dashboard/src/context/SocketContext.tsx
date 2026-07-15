import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";
import { io, type Socket } from "socket.io-client";
import { API_URL } from "../api/client";
import { useAuth } from "./AuthContext";

const SocketContext = createContext<Socket | null>(null);

export function SocketProvider({ children }: { children: ReactNode }) {
  const { token } = useAuth();

  const socket = useMemo(() => {
    if (!token) return null;
    return io(API_URL, { auth: { token }, autoConnect: true });
  }, [token]);

  useEffect(() => {
    return () => {
      socket?.disconnect();
    };
  }, [socket]);

  return <SocketContext.Provider value={socket}>{children}</SocketContext.Provider>;
}

export function useSocket() {
  return useContext(SocketContext);
}
