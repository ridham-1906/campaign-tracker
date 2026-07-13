Model:

1. user: name, email, app passwrod for nodemailer, password
2. sales: name, email
3. vendor: name
4. client: name 
5. campaign: backend_person, sales_person, vendor, client,city, type, location, days, startdate, enddate
6. reminder: campaign, date

flow:
akcend persn can track all the campaign of them

can add new campaign, view and edit campaigns

main func:
reminder:
evryday reminder api should run using cron and it find all the reminder that will be exected on current date like reminder date is( reminder date is 7 days before exiration of campaiign but user can set what they want) -> wvery day it check for campaign that's reminder is set  -> if todays' reminder set -> send the email to the sales person of that campaign for expiration is soon of campaign  