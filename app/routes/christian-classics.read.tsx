import type {
  MetaFunction,
  LoaderFunctionArgs,
  ActionFunctionArgs,
} from "@remix-run/node";
import { WorkReader } from "~/features/work-reader/WorkReader";
import {
  workReaderLoader,
  workReaderAction,
} from "~/features/work-reader/route.server";
export const loader = (args: LoaderFunctionArgs) =>
  workReaderLoader(args, "classics");
export const action = (args: ActionFunctionArgs) =>
  workReaderAction(args, "classics");
export const meta: MetaFunction = () => [
  { title: "Christian Classics Reader | Cross Canon" },
];
export default WorkReader;
