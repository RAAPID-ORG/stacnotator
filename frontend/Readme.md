**DEPRECATED NEED TO UPDATE**


Current quick'n dirty intro to our proj:
- we use openapi-ts to auto-generate a client based on the openapi specification of our backend
- we currently only support firebae auth, but can easily be extended to other providers.
- provider tokens will be attached to header for auth for requests to the backend
- we use tailwind.css for style
- app should be structured into pages + components + api
- components should be grouped by feature or shared
- pages typically handle data fetching etc
- .env.local contains env variables such as backend server url or firebase keys
- we use es6 syntax and arrow functions where applicable
- file naming: PascalCase for components, kebab-case for folders, camelCase for other files
- run npm run format before commiting to enforece coding standards
