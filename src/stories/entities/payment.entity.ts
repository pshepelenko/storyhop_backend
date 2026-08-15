import { PrimaryColumn, Column, Entity } from 'typeorm';

@Entity("payments")
export class Payment {
    @PrimaryColumn()
    id: string;
  
    @Column()
    userId: string;

    @Column()
    webhookId: string;
        
    @Column()
    date: Date;
    
    @Column()
    amount: number;
    
    @Column()
    status: string;

}

