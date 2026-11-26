import { useApp } from '@/state/AppProvider';
import type { Letterhead } from '@/domain/receipt';
import { useBrand } from '@/ui/receipt';

/** Who the receipt is from: the credit union, the branch and the officer, plus the logo if one has been synced. */
export function useLetterhead(): Letterhead & { logo: string | null } {
  const brand = useBrand();
  const { session } = useApp();
  return { creditUnion: brand.creditUnion, branch: brand.branch, officer: session?.officerName ?? '', logo: brand.logo };
}
