import Icon from '@/components/Icon'
import { sentimentOf } from './types'

/** A small marker that always carries a word: icon plus label, coloured by mood. */
export default function SentimentMark({ sentiment, className = '' }: { sentiment?: string | null; className?: string }) {
  const s = sentimentOf({ sentiment })
  return (
    <span className={`tag ${s.tag} ${className}`}>
      <Icon name={s.icon} className="h-3.5 w-3.5" strokeWidth={2.2} />
      {s.label}
    </span>
  )
}
