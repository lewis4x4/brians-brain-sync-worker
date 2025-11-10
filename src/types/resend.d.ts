declare module 'resend' {
  export class Resend {
    constructor(apiKey: string);
    emails: {
      send(params: {
        from: string;
        to: string;
        subject: string;
        html: string;
      }): Promise<{ data: any; error: any }>;
    };
  }
}
