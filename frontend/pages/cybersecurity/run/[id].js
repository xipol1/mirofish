// Legacy route — the Cyber Swarm run view is now inline in /cybersecurity.
// Redirect to the new entry point.
import { useEffect } from 'react';
import { useRouter } from 'next/router';

export default function CyberRunRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/cybersecurity');
  }, [router]);
  return (
    <div className="min-h-screen bg-[#08080e] text-gray-500 flex items-center justify-center">
      Redirecting…
    </div>
  );
}
