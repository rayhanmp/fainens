import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useEffect } from 'react';

export const Route = createFileRoute('/split')({
  component: SplitBillRedirect,
});

function SplitBillRedirect() {
  const navigate = useNavigate();

  useEffect(() => {
    void navigate({
      to: '/agent',
      search: { prompt: 'Help me split a bill. I will attach the receipt and tell you who shared it.' },
      replace: true,
    });
  }, [navigate]);

  return null;
}
