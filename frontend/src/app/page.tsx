import { redirect } from 'next/navigation';

/** Root redirects into the authenticated app shell; the shell guards auth. */
export default function Home() {
  redirect('/dashboard');
}
