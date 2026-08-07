import { AGENT_ROBOT_SRC, agentTint } from './agent-visual';

type AgentAvatarProps = {
  readonly agentId: string;
  readonly name: string;
  /** Visual size — sm for tables, md for detail bands, lg for empty/hero moments. */
  readonly size?: 'sm' | 'md' | 'lg';
  readonly className?: string;
};

const sizePx = { sm: 32, md: 48, lg: 72 } as const;

/**
 * Compact tinted robot used wherever an agent needs a face mark
 * (roster rows, treasury access, detail header).
 */
export function AgentAvatar({ agentId, name, size = 'sm', className }: AgentAvatarProps) {
  const tint = agentTint(agentId);
  const px = sizePx[size];

  return (
    <span
      aria-hidden="true"
      className={['agent-robot-avatar', `is-${size}`, className].filter(Boolean).join(' ')}
      style={{
        width: px,
        height: px,
        ['--agent-tint' as string]: tint.color,
        ['--agent-glow' as string]: tint.glow,
      }}
      title={name}
    >
      <span className="agent-robot-avatar-glow" />
      <span className="agent-robot-avatar-tint" style={{ background: tint.color }} />
      <img
        alt=""
        className="agent-robot-avatar-img"
        draggable={false}
        height={px}
        src={AGENT_ROBOT_SRC}
        width={px}
      />
    </span>
  );
}
