FROM ghcr.io/puppeteer/puppeteer:latest

# Switch to root to install packages and copy files
USER root

# Set the working directory
WORKDIR /usr/src/app

# --- CRITICAL FIX ---
# This tells Puppeteer: "Do not download Chrome, use the one installed in the image"
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome-stable

# Copy package files
COPY package*.json ./

# Install dependencies (now it will be fast because it won't download Chrome)
RUN npm install

# Copy the rest of your bot code
COPY . .

# Run the bot
CMD [ "node", "bot.js" ]