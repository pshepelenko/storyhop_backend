import { PrimaryColumn, Column, Entity } from 'typeorm';

@Entity("clients")
export class Client {
    @PrimaryColumn()
    clientId: string;
  
    @Column({
        type: 'jsonb',
        array: false,
        default: () => "'[]'",
        nullable: true,
      })
      public assistants: Array<{ chatbotId: string, assistantId: string }>;
    
  }

export class Story {}
