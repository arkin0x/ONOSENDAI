"use client"
import { useEffect } from "react";
import useNDKStore, { NDKStoreConfig, defaultRelays } from "../store/NDKStore";
import Loading from "../components/Loading";

// const redisURL = "https://localhost:6379"

export default function NDKProvider({ children }: { children: React.ReactNode }) {
  const { initNDK, isConnected } = useNDKStore();

  useEffect(() => {
    const opts: NDKStoreConfig = {
      relayUrls: defaultRelays,
      // redisUrl: redisURL,
      useExtension: !!localStorage.getItem('useExtension')
    }

    initNDK(opts)//, redisURL);
  }, [initNDK]);

  if (!isConnected) {
    return <Loading/>
  }

  return children
}