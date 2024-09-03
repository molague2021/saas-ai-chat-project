'use client';

import { FormEvent, useEffect, useRef, useState, useTransition } from 'react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Loader2Icon } from 'lucide-react';
import { useCollection } from 'react-firebase-hooks/firestore';
import { useUser } from '@clerk/nextjs';
import { collection, orderBy, query } from 'firebase/firestore';
import { db } from '../firebase';
import { askQuestions } from '../actions/askQuestions';

type RoleType = 'human' | 'ai' | 'placeholder';

export type Message = {
  id?: string;
  role: RoleType;
  message: string;
  createdAt: Date;
};

export const Chat = ({ id }: { id: string }) => {
  const { user } = useUser();

  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [isPending, startTransition] = useTransition();

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();

    const q = input;
    setInput('');

    // optimistic UI update
    setMessages((prev) => [
      ...prev,
      {
        role: 'human',
        message: q,
        createdAt: new Date(),
      },
      {
        role: 'ai',
        message: 'Thinking...',
        createdAt: new Date(),
      },
    ]);

    startTransition(async () => {
      const { success, message } = await askQuestions(id, q);

      if (!success) {
        // toast notification incoming...

        setMessages((prev) =>
          prev.slice(0, prev.length - 1).concat([
            {
              role: 'ai',
              message: `whoops... ${message}`,
              createdAt: new Date(),
            },
          ])
        );
      }
    });
  };

  const [snapshot, loading, error] = useCollection(
    user &&
      query(
        collection(db, 'users', user?.id, 'files', id, 'chat'),
        orderBy('createdAt', 'asc')
      )
  );

  useEffect(() => {
    if (!snapshot) return;

    console.log('updated snapshot', snapshot.docs);

    const lastMessage = messages.pop();

    if (lastMessage?.role === 'ai' && lastMessage.message === 'Thinking...') {
      // Return as this is a dummy placeholder message
      return;
    }

    const newMessages: Message[] = snapshot.docs.map((doc) => {
      const { role, message, createdAt } = doc.data();

      return {
        id: doc.id,
        role,
        message,
        createdAt: createdAt.toDate(),
      };
    });

    setMessages(newMessages);

    // Ignore messages dependency here.... or an infinite loop may be caused
  }, [snapshot]);

  return (
    <div className="flex flex-col h-full overflow-scroll">
      {/** Chat Contents */}
      <div className="flex-1 w-full">
        {/** chat messages... */}
        {messages.map((message) => (
          <div key={message.id}>
            <p>{message.message}</p>
          </div>
        ))}
      </div>
      <form
        onSubmit={handleSubmit}
        className="flex sticky bottom-0 space-x-2 p-5 bg-indigo-600/75"
      >
        <Input
          value={input}
          placeholder="Ask a Question..."
          onChange={(e) => setInput(e.target.value)}
        />
        <Button type="submit" disabled={!input || isPending}>
          {isPending ? (
            <Loader2Icon className="animate-spin text-indigo-600" />
          ) : (
            'Ask'
          )}
        </Button>
      </form>
    </div>
  );
};
