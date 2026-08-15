import { PrimaryColumn, Column, Entity } from 'typeorm';

@Entity("stories")
export class Story {
    @PrimaryColumn()
    storyId: string;
  
    @Column()
    userId: string;
    
    @Column()
    threadId: string;

    @Column()
    world: string;

    @Column()
    age: string;

    @Column()
    comments: string;

    @Column()
    lastQuestion: string;

    @Column()
    title: string;

    @Column()
    coverURL: string;

    @Column()
    language: string;
    
    @Column({
        type: 'jsonb',
        array: false,
        default: () => "'[]'",
        nullable: true,
      })
      public  audioURLs: Array<{
        chapterId: string;
        type: string;
        URL: string;        
      }>;
    
        
    @Column()
    text: string;

    @Column()
    createdAt: Date;
    
    @Column()
    updatedAt: Date;

    @Column()
    chapterNumber: number;

}

