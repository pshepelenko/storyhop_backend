import { PrimaryColumn, Column, Entity } from 'typeorm';

@Entity("choices")
export class Choice {
    @PrimaryColumn()
    id: string;
  
    @Column()
    storyId: string;

    @Column()
    userId: string;

    @Column()
    chapterId: string;

    @Column()
    decisionType: string;

    @Column()
    choiceText: string;

    @Column()
    timeStamp: Date;

  }

