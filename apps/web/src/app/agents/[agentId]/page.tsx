import { redirect } from 'next/navigation';

export default function LegacyAgentDetailPage() {
  redirect('/auth');
}
