import { DbAwareColumn } from '@server/utils/DbColumnHelper';
import {
  Column,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity()
export class MediaCleanupSnooze {
  @PrimaryGeneratedColumn()
  public id: number;

  @Column()
  @Index({ unique: true })
  public mediaId: number;

  @DbAwareColumn({ type: 'datetime', default: () => 'CURRENT_TIMESTAMP' })
  public snoozedAt: Date;

  @DbAwareColumn({ type: 'datetime' })
  public snoozeUntil: Date;
}
