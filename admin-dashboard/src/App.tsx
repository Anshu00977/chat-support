import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "./context/AuthContext";
import { SocketProvider } from "./context/SocketContext";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { Layout } from "./components/Layout";
import { LoginPage } from "./pages/LoginPage";
import { InboxPage } from "./pages/InboxPage";
import { ConversationPage } from "./pages/ConversationPage";
import { AdminsPage } from "./pages/AdminsPage";
import { AppsPage } from "./pages/AppsPage";

export default function App() {
  return (
    <AuthProvider>
      <SocketProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route
              path="/"
              element={
                <ProtectedRoute>
                  <Layout>
                    <InboxPage />
                  </Layout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/conversations/:id"
              element={
                <ProtectedRoute>
                  <Layout>
                    <ConversationPage />
                  </Layout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/apps"
              element={
                <ProtectedRoute>
                  <Layout>
                    <AppsPage />
                  </Layout>
                </ProtectedRoute>
              }
            />
            <Route
              path="/admins"
              element={
                <ProtectedRoute requireSuperAdmin>
                  <Layout>
                    <AdminsPage />
                  </Layout>
                </ProtectedRoute>
              }
            />
          </Routes>
        </BrowserRouter>
      </SocketProvider>
    </AuthProvider>
  );
}
