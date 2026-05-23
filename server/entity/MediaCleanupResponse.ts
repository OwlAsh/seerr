import { DbAwareColumn } from '@server/utils/DbColumnHelper';
import {
  Column,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';

@Entity()
@Unique(['mediaId', 'userId'])
export class MediaCleanupResponse {
  @PrimaryGeneratedColumn()
  public id: number;

  @Column()
  @Index()
  public mediaId: number;

  @Column()
  @Index()
  public userId: number;

  @Column({ type: 'varchar' })
  public response: 'consent' | 'snooze';

  @DbAwareColumn({ type: 'datetime', default: () => 'CURRENT_TIMESTAMP' })
  public respondedAt: Date;

  @DbAwareColumn({ type: 'datetime', nullable: true })
  public snoozeUntil: Date | null;
}
