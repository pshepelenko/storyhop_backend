import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from './stories/entities/user.entity';
import * as moment from 'moment';
import { Finder } from './finder';
import { Client } from './chats/entities/client.entity';

export class Biller {
    constructor(
        @InjectRepository(User)
        private usersRepository: Repository<User>,    
        @InjectRepository(Client)
        private clientsRepository: Repository<Client>,
    ) {
        
    }
    async renewSubscription(
        channel: string,
        userId: string,
        chatbotId: string     
    ): Promise<string> {
    
        let finder = new Finder(this.usersRepository, this.clientsRepository);
        let user = await finder.findUser(channel, userId);
        
        let subscription = user.subscriptions.find(sub => sub.chatbotId === chatbotId && sub.channelId === channel);
        
        if (!subscription) {
            // Add a new subscription if not found
            subscription = {
              chatbotId: chatbotId,
              channelId: channel,
              plan: 'premium',
              limit: 1000,
              expirationDate: moment().add(1, 'month').toDate()
            };
            user.subscriptions.push(subscription);
          } else {
            // Update existing subscription
            subscription.plan = 'premium';
            subscription.limit = 1000;
            subscription.expirationDate = moment().add(1, 'month').toDate();
          }
        await this.usersRepository.save(user);
        
        
        return 'success';
    
    }
    async checkSubscription(
        channel: string,
        userId: string,
        chatbotId: string,
        userFullName = '',
        userTelegramAlias = ''     
    ): Promise<boolean> {
        let finder = new Finder(this.usersRepository, this.clientsRepository);
        let user = await finder.findUser(channel, userId, userFullName, userTelegramAlias);

        console.log('user subscription ',user.subscriptions);
        let subscription = user.subscriptions.find(sub => sub.chatbotId === chatbotId && sub.channelId === channel);
    

        if (!subscription) {
            // Add a new subscription if not found
            subscription = {
              chatbotId: chatbotId,
              channelId: channel,
              plan: 'free',
              limit: 20,
              expirationDate: moment().add(100, 'year').toDate()
            };
            user.subscriptions.push(subscription);
            await this.usersRepository.save(user);
          }

        return subscription.limit > 0;;
    }
    
    async getSubscriptionDetails(
        channel: string,
        userId: string,
        chatbotId: string,
        userFullName = '',
        userTelegramAlias = ''     
    ): Promise<any> {
        let finder = new Finder(this.usersRepository, this.clientsRepository);
        let user = await finder.findUser(channel, userId, userFullName, userTelegramAlias);

        console.log('user subscription ',user.subscriptions);
        let subscription = user.subscriptions.find(sub => sub.chatbotId === chatbotId && sub.channelId === channel);
    
        let result = {
            plan: 'Подписка отсутствует',
            limit: 20
          };

        if (subscription) {
            result = {
              plan: subscription.plan,
              limit: subscription.limit
            };
        
          }

        return result;
    }


    async decreaseLimit(
        channel: string,
        userId: string,
        chatbotId: string     
    ): Promise<boolean> {
        let finder = new Finder(this.usersRepository, this.clientsRepository);
        let user = await finder.findUser(channel, userId);

        let subscription = user.subscriptions.find(sub => sub.chatbotId === chatbotId && sub.channelId === channel);
        
        if (!subscription) {
            throw new Error(`No subscription found for chatbot ${chatbotId}`);
        }

        if (subscription.limit <= 0) { 
            return false;
        }

        // Check if the plan is 'premium' but the expiration date is earlier than the current date
        if (subscription.plan === 'premium' && moment(subscription.expirationDate).isBefore(moment())) {
            subscription.plan = 'free';
            subscription.limit = 20;
            subscription.expirationDate = moment().add(100, 'year').toDate();
        } else {
            subscription.limit -= 1;
        }

        await this.usersRepository.save(user);

        return true;
    }
}