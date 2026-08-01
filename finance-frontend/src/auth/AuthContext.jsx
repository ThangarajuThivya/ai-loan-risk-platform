import { createContext, useState, useEffect, useContext } from "react";

import api, { setAccessToken } from "../api/axios";
import { useToast } from "../components/toast/useToast";

const AuthContext = createContext();

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const { showToast } = useToast();

  const [loading, setLoading] = useState(true);

  useEffect(() => {
    console.log("Auth Check Running");
    const checkLogin = async () => {
      try {
        const res = await api.post("/auth/refresh");

        setAccessToken(res.data.accessToken);

        // User details get

        const userResponse = await api.get("/auth/me");

        setUser(userResponse.data.user);
      } catch (error) {
        setUser(null);
      } finally {
        setLoading(false);
      }
    };

    checkLogin();
  }, []);

  // const login = async (data) => {
  //   const res = await api.post("/auth/login", data);

  //   setAccessToken(res.data.accessToken);

  //   setUser(res.data.user);

  //   return res.data.user;
  // };

  const login = async (data) => {
    try {
      const res = await api.post("/auth/login", data);

      setAccessToken(res.data.accessToken);

      setUser(res.data.user);

      
      return res.data.user;
    } catch (error) {
      console.log(error)
    
      throw error;
    }
  };
  const logout = async () => {
    try {
      await api.post("/auth/logout");
    } finally {
      setAccessToken(null);

      setUser(null);
    }
  };

  if (loading) {
    return <h1>Loading...</h1>;
  }

  return (
    <AuthContext.Provider
      value={{
        user,

        login,

        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
