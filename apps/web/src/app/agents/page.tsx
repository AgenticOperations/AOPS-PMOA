import { redirect } from 'next/navigation';

export default function LegacyAgentsPage() {
  redirect('/auth');
}
