'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

const apiBaseUrl = process.env.API_BASE_URL || 'http://localhost:4000';

type Person = { full_name: string; email: string; kind: string; credits: string };

export default function ParticipantDashboard() {
  const router = useRouter();
  const [person, setPerson] = useState<Person | null>(null);

  useEffect(() => {
    fetch(`${apiBaseUrl}/api/me`, { credentials: 'include' })
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((me: Person) => {
        if (me.kind !== 'participant') {
          router.push(me.kind === 'admin' ? '/admin' : '/coach');
          return;
        }
        setPerson(me);
      })
      .catch(() => router.push('/login'));
  }, [router]);

  if (!person) return <main><p className="state">Loading...</p></main>;

  return (
    <main>
      <h1>Participant dashboard</h1>
      <p>{person.full_name}</p>
      <p>{person.email}</p>
      <p>{Number(person.credits).toFixed(0)} credits</p>
    </main>
  );
}
