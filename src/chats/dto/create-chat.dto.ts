export class CreateChatDto {}

export class ChatRequestDto {
  chatBotId: string;  
  message: string;
  userId: string;
  userFullName: string;
  userTelegramAlias: string;
  channelId: string;
  systemMessage: string;    
    // campaignData: {
    //   campaignId: string;
    //   startDate: Date;
    //   endDate: Date;
    //   name: string;
    //   tagline: string;
    //   offerData: {
    //     text: string;
    //     couponCode: string;
    //     startDate: Date;
    //     endDate: Date;
    //     enabled: boolean;
    //   },
    //   USPData: {
    //     icon: string;
    //     text: string;
    //   }[];
    // };
    // productsData:{
    //     id: string;
    //     storeId: string;
    //     title: string;
    //     image: string;
    //     price: number;
    //     promoPrice: number;
    //     promoEndDate: Date;
    //     rating: number;
    //     reviewsNumber: number;
    //     URL: string;
    // }[];  
    // displaySettings: {
    //   showPrices: boolean;
    //   showReviews: boolean;
    // };
    // productFilesLinks: number[]  
  }
  