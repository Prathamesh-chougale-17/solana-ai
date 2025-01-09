// services/taskGeneratorService.ts
import { GoogleGenerativeAI } from "@google/generative-ai";
import clientPromise from "../lib/clientpromise";
import { ObjectId } from "mongodb";
import TwitterApi from "twitter-api-v2";

export interface GeneratedTask {
  description: string;
  category: "blockchain" | "memes" | "nfts";
  requirements: string[];
  evaluationCriteria: string[];
}

const twitterClient = new TwitterApi({
  appKey: process.env.TWITTER_API_KEY!,
  appSecret: process.env.TWITTER_API_SECRET!,
  accessToken: process.env.TWITTER_ACCESS_TOKEN!,
  accessSecret: process.env.TWITTER_ACCESS_TOKEN_SECRET!,
});

export class TaskGeneratorService {
  private static async generateTaskWithAI(): Promise<GeneratedTask> {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
    const model = genAI.getGenerativeModel({ model: "gemini-pro" });

    const prompt = `
      Generate a creative Twitter task related to one of these categories: blockchain, memes, or NFTs.
      The task should be engaging, clear, and encourage creative responses.
      Return ONLY a valid JSON object with no additional text, markdown or explanation. It should start with an opening curly brace '{' and end with a closing curly brace '}'.
      The JSON must strictly follow this format:
      {
        "title": "task title",
        "description": "clear task description",
        "category": "one of: blockchain, memes, nfts",
        "requirements": ["list of specific requirements"],
        "evaluationCriteria": ["specific criteria for judging"]
        "rewards": {
          "usdcAmount": "any number from 1 to 1000",
          "nftReward": "optional NFT reward"
        }

      }

      Make the task fun and engaging while maintaining relevance to crypto/web3 culture.
    `;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    return JSON.parse(response.text());
  }

  private static async GenerateTweetContent(
    task: GeneratedTask,
    taskId: string
  ) {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
    const model = genAI.getGenerativeModel({ model: "gemini-pro" });

    // Helper to escape special characters
    const escapeSpecialChars = (str: string) =>
      str.replace(/[\n\r\t]/g, " ").replace(/"/g, '\\"');

    // Sanitize inputs
    const taskDescription = escapeSpecialChars(task.description);
    const taskRequirements = task.requirements
      .map(escapeSpecialChars)
      .join(", ");
    const taskCriteria = task.evaluationCriteria
      .map(escapeSpecialChars)
      .join(", ");

    // Prompt for AI
    const prompt = `
    You are tasked with creating a tweet to promote a specific task on Bounty Quest. 
    Use the details below to craft a creative, engaging, and persuasive tweet:
  
    1. **Task Description**: ${taskDescription}
    2. **Task Requirements**: ${taskRequirements}
    3. **Evaluation Criteria**: ${taskCriteria}
  
    **Goal**: Encourage users to participate in this task. Include the task link in the tweet:
    https://solana-ai-steel.vercel.app/tasks/${taskId}
  
    **Format Requirements**:
    - The tweet should have proper formatting with line breaks for readability.
    - Use emojis to make the tweet engaging.
    - Include the task link and relevant hashtags like #BountyQuest, #Blockchain, etc.
    - Keep the tweet within the 280 character limit.
  
    Respond with the text of the tweet only. Do not include any additional text, JSON format, or comments.
    `;

    // Get response
    const result = await model.generateContent(prompt);
    const tweetContent = result.response.text().trim();
    return tweetContent;
  }

  public static async createNewTask(
    durationHours: number = 4
  ): Promise<string> {
    const task = await this.generateTaskWithAI();

    const client = await clientPromise;
    const db = client.db("tweetcontest");

    const startTime = new Date();
    const endTime = new Date(
      startTime.getTime() + durationHours * 60 * 60 * 1000
    );

    const result = await db.collection("tasks").insertOne({
      ...task,
      startTime,
      endTime,
      isActive: true,
      winners: [],
      isWinnerDeclared: false,
      _id: new ObjectId(),
    });
    // await this.PostTweetofTask(task, result.insertedId.toString());
    return result.insertedId.toString();
  }

  public static async getActiveTask() {
    const client = await clientPromise;
    const db = client.db("tweetcontest");
    // if task has ended, set isActive to false
    await this.checkTaskStatus();
    return db.collection("tasks").find({ isActive: true }).toArray();
  }

  public static async PostTweetofTask(task: GeneratedTask, taskId: string) {
    try {
      const tweetContent = await this.GenerateTweetContent(task, taskId);
      const tweet = await twitterClient.v1.tweet("statuses/update", {
        status: tweetContent,
      });
      console.log("Tweet posted:", tweet);
    } catch (error) {
      console.error("Error posting tweet:", error);
    }
  }

  public static async getActiveTaskById(taskId: string) {
    const client = await clientPromise;
    const db = client.db("tweetcontest");
    return db
      .collection("tasks")
      .findOne({ _id: new ObjectId(taskId), isActive: true });
  }

  public static async getTaskById(taskId: string) {
    const client = await clientPromise;
    const db = client.db("tweetcontest");
    return db.collection("tasks").findOne({ _id: new ObjectId(taskId) });
  }

  public static async setTaskInactive(taskId: string) {
    const client = await clientPromise;
    const db = client.db("tweetcontest");
    return db
      .collection("tasks")
      .updateOne({ _id: new ObjectId(taskId) }, { $set: { isActive: false } });
  }

  public static async getPastTasks() {
    const client = await clientPromise;
    const db = client.db("tweetcontest");
    return db.collection("tasks").find({ isActive: false }).toArray();
  }

  public static async setTaskWinner() {
    const winners: string[] = [];
    const client = await clientPromise;
    const db = client.db("tweetcontest");
    const tasks = db.collection("tasks");
    const submission = db.collection("submissions");
    // check if the task isActive is false and isWinnerDeclared is false
    const completedTask = await tasks
      .find({ isActive: false, isWinnerDeclared: false })
      .toArray();
    // After task is inactive then evaluate the task as submission collection have the task id and submission score. update the top 3 winners in the task collection winner field array
    const taskIds = completedTask.map((task) => task._id);

    for (const taskId of taskIds) {
      const submissions = await submission
        .find({ taskId: taskId.toString() })
        .sort({ "scores.overall": -1 })
        .limit(3)
        .toArray();
      const winners = submissions.map((submission) => submission.publicKey);
      const updatedWinner = await tasks.updateOne(
        {
          _id: taskId,
        },
        { $set: { winners } }
      );

      if (updatedWinner.modifiedCount > 0) {
        await tasks.updateOne(
          { _id: taskId },
          { $set: { isWinnerDeclared: true } }
        );
        winners.push(submissions.map((submission) => submission.publicKey));
      }
    }
    return winners;
  }

  // write a method to set the task as inactive if the end time has passed
  public static async checkTaskStatus() {
    const client = await clientPromise;
    const db = client.db("tweetcontest");
    const currentTime = new Date();

    return db
      .collection("tasks")
      .updateMany(
        { endTime: { $lt: currentTime } },
        { $set: { isActive: false } }
      );
  }
}
