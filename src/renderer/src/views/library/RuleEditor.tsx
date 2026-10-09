import type { Collection } from '../../../../shared/ipc'
import {
  defaultRule,
  isGroup,
  opTakesValue,
  SMART_FIELDS,
  SMART_OPS,
  type SmartField,
  type SmartGroup,
  type SmartOp,
  type SmartRule
} from '../../../../shared/smart'
import { Icon } from '../../components/icons'
import { Stars } from '../../components/ui'
import { t } from '../../lib/i18n'
import { newRule, withOp } from '../../lib/rules'

const FIELDS = Object.entries(SMART_FIELDS) as [SmartField, (typeof SMART_FIELDS)[SmartField]][]

/** Groups nest this deep at most: deeper is never clearer. */
const MAX_DEPTH = 3

const stop = (e: React.KeyboardEvent): void => e.stopPropagation()

function NumberInput({
  value,
  onChange,
  label
}: {
  value: unknown
  onChange: (n: number) => void
  label: string
}): React.JSX.Element {
  return (
    <input
      type="number"
      className="rule-num"
      aria-label={label}
      value={Number.isFinite(Number(value)) ? Number(value) : 0}
      step="any"
      onChange={(e) => onChange(Number(e.target.value))}
      onKeyDown={stop}
    />
  )
}

function DateInput({
  value,
  onChange,
  label
}: {
  value: unknown
  onChange: (d: string) => void
  label: string
}): React.JSX.Element {
  return (
    <input
      type="date"
      className="rule-date"
      aria-label={label}
      value={typeof value === 'string' ? value : ''}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={stop}
    />
  )
}

/** The value part of a rule, shaped by its field's type and its operator. */
function ValueEditor({
  rule,
  onChange,
  collections
}: {
  rule: SmartRule
  onChange: (r: SmartRule) => void
  collections: Collection[]
}): React.JSX.Element | null {
  const info = SMART_FIELDS[rule.field]
  if (!opTakesValue(rule.op)) return null
  const set = (value: SmartRule['value'], extra: Partial<SmartRule> = {}): void =>
    onChange({ ...rule, value, ...extra })
  const pair = Array.isArray(rule.value) ? rule.value : [rule.value, rule.value]
  const and = <span className="rule-and">{t('and')}</span>
  switch (info.type) {
    case 'rating':
      if (rule.op === 'between')
        return (
          <span className="rule-value">
            <Stars value={Number(pair[0]) || 0} onChange={(v) => set([v, Number(pair[1]) || 0])} />
            {and}
            <Stars value={Number(pair[1]) || 0} onChange={(v) => set([Number(pair[0]) || 0, v])} />
          </span>
        )
      return (
        <span className="rule-value">
          <Stars value={Number(rule.value) || 0} onChange={(v) => set(v)} />
          <span className="muted t-num">{Number(rule.value) || 0}</span>
        </span>
      )
    case 'number':
      return (
        <span className="rule-value">
          {rule.op === 'between' ? (
            <>
              <NumberInput
                label={t('From')}
                value={pair[0]}
                onChange={(n) => set([n, Number(pair[1]) || 0])}
              />
              {and}
              <NumberInput
                label={t('To')}
                value={pair[1]}
                onChange={(n) => set([Number(pair[0]) || 0, n])}
              />
            </>
          ) : (
            <NumberInput label={t('Value')} value={rule.value} onChange={(n) => set(n)} />
          )}
          {info.unit && <span className="muted">{info.unit}</span>}
        </span>
      )
    case 'enum':
      return (
        <select
          className="rule-value"
          aria-label={t('Value')}
          value={String(rule.value ?? '')}
          onChange={(e) => set(e.target.value)}
        >
          {info.options?.map((o) => (
            <option key={o.value} value={o.value}>
              {t(o.label)}
            </option>
          ))}
        </select>
      )
    case 'boolean':
      return (
        <select
          className="rule-value"
          aria-label={t('Value')}
          value={rule.value ? 'yes' : 'no'}
          onChange={(e) => set(e.target.value === 'yes')}
        >
          <option value="yes">{t('Yes')}</option>
          <option value="no">{t('No')}</option>
        </select>
      )
    case 'collection':
      return (
        <select
          className="rule-value"
          aria-label={t('Collection')}
          value={String(rule.value ?? '')}
          onChange={(e) => set(e.target.value)}
        >
          <option value="">{t('Choose…')}</option>
          {collections.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      )
    case 'date':
      if (rule.op === 'inLast')
        return (
          <span className="rule-value">
            <NumberInput label={t('How many')} value={rule.value} onChange={(n) => set(n)} />
            <select
              aria-label={t('Unit')}
              value={rule.unit ?? 'days'}
              onChange={(e) => set(rule.value, { unit: e.target.value as SmartRule['unit'] })}
            >
              <option value="days">{t('days')}</option>
              <option value="weeks">{t('weeks')}</option>
              <option value="months">{t('months')}</option>
              <option value="years">{t('years')}</option>
            </select>
          </span>
        )
      if (rule.op === 'between')
        return (
          <span className="rule-value">
            <DateInput
              label={t('From')}
              value={pair[0]}
              onChange={(d) => set([d, String(pair[1])])}
            />
            {and}
            <DateInput
              label={t('To')}
              value={pair[1]}
              onChange={(d) => set([String(pair[0]), d])}
            />
          </span>
        )
      return <DateInput label={t('Day')} value={rule.value} onChange={(d) => set(d)} />
    default:
      return (
        <input
          className="rule-value rule-text"
          aria-label={t('Value')}
          value={String(rule.value ?? '')}
          placeholder={rule.field === 'keyword' ? 'Places > Canada' : ''}
          onChange={(e) =>
            set(rule.field === 'keyword' ? e.target.value.replace(/\s*>\s*/g, '|') : e.target.value)
          }
          onKeyDown={stop}
        />
      )
  }
}

function RuleRow({
  rule,
  onChange,
  onRemove,
  collections
}: {
  rule: SmartRule
  onChange: (r: SmartRule) => void
  onRemove: () => void
  collections: Collection[]
}): React.JSX.Element {
  const info = SMART_FIELDS[rule.field]
  return (
    <div className="rule-row">
      <select
        className="rule-field"
        aria-label={t('Field')}
        value={rule.field}
        onChange={(e) => onChange(defaultRule(e.target.value as SmartField))}
      >
        {FIELDS.map(([f, i]) => (
          <option key={f} value={f}>
            {t(i.label)}
          </option>
        ))}
      </select>
      <select
        className="rule-op"
        aria-label={t('Operator')}
        value={rule.op}
        onChange={(e) => onChange(withOp(rule, e.target.value as SmartOp))}
      >
        {info.ops.map((op) => (
          <option key={op} value={op}>
            {t(SMART_OPS[op])}
          </option>
        ))}
      </select>
      <ValueEditor rule={rule} onChange={onChange} collections={collections} />
      <span className="spacer" />
      <button
        className="icon sm"
        title={t('Remove this rule')}
        aria-label={t('Remove rule')}
        onClick={onRemove}
      >
        <Icon name="minus" />
      </button>
    </div>
  )
}

/**
 * A rule group: match all, any or none of its rules and groups. Groups nest
 * ("rating ≥ 3 and (Canon or Fujifilm)").
 */
export function GroupEditor({
  group,
  onChange,
  onRemove,
  collections,
  depth = 0
}: {
  group: SmartGroup
  onChange: (g: SmartGroup) => void
  onRemove?: () => void
  /** The collections a rule may name (never the one being edited). */
  collections: Collection[]
  depth?: number
}): React.JSX.Element {
  const setRule = (i: number, r: SmartRule | SmartGroup | null): void => {
    const rules = [...group.rules]
    if (r === null) rules.splice(i, 1)
    else rules[i] = r
    onChange({ ...group, rules })
  }
  return (
    <div className={`rule-group${depth > 0 ? ' nested' : ''}`}>
      <div className="rule-group-head">
        <span>{t('Match')}</span>
        <select
          aria-label={t('Match')}
          value={group.match}
          onChange={(e) => onChange({ ...group, match: e.target.value as SmartGroup['match'] })}
        >
          <option value="all">{t('all')}</option>
          <option value="any">{t('any')}</option>
          <option value="none">{t('none')}</option>
        </select>
        <span>{depth > 0 ? t('of the following') : t('of the following rules')}</span>
        <span className="spacer" />
        <button
          className="sm"
          onClick={() => onChange({ ...group, rules: [...group.rules, newRule()] })}
        >
          <Icon name="plus" />
          {t('Rule')}
        </button>
        {depth < MAX_DEPTH && (
          <button
            className="sm"
            title={t('A group of rules with its own all / any / none')}
            onClick={() =>
              onChange({
                ...group,
                rules: [...group.rules, { match: 'any', rules: [newRule()] }]
              })
            }
          >
            <Icon name="plus" />
            {t('Group')}
          </button>
        )}
        {onRemove && (
          <button
            className="icon sm"
            title={t('Remove this group')}
            aria-label={t('Remove group')}
            onClick={onRemove}
          >
            <Icon name="close" />
          </button>
        )}
      </div>
      {group.rules.length === 0 && (
        <p className="rule-empty">{t('No rules yet: every photo matches.')}</p>
      )}
      {group.rules.map((r, i) =>
        isGroup(r) ? (
          <GroupEditor
            key={i}
            group={r}
            depth={depth + 1}
            collections={collections}
            onChange={(g) => setRule(i, g)}
            onRemove={() => setRule(i, null)}
          />
        ) : (
          <RuleRow
            key={i}
            rule={r}
            collections={collections}
            onChange={(next) => setRule(i, next)}
            onRemove={() => setRule(i, null)}
          />
        )
      )}
    </div>
  )
}
