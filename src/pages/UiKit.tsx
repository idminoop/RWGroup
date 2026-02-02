import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Heading, Text } from '@/components/ui/Typography'
import { Home, Loader2, Mail, Search, Trash2 } from 'lucide-react'

export default function UiKitPage() {
  return (
    <div className="min-h-screen bg-slate-50 p-10 space-y-10">
      <Heading size="h1">UI Kit & Design System</Heading>
      <Text size="lg" muted>
        Base components and styles for RWGroup website.
      </Text>

      <section className="space-y-4">
        <Heading size="h3">Typography</Heading>
        <div className="space-y-2 border p-4 rounded-lg bg-white">
          <Heading size="h1">Heading 1 (Manrope)</Heading>
          <Heading size="h2">Heading 2</Heading>
          <Heading size="h3">Heading 3</Heading>
          <Heading size="h4">Heading 4</Heading>
          <Text>
            Body text. Lorem ipsum dolor sit amet, consectetur adipiscing elit. 
            <span className="font-bold">Bold text</span>. <span className="italic">Italic text</span>.
          </Text>
          <Text size="sm" muted>Small muted text for captions.</Text>
        </div>
      </section>

      <section className="space-y-4">
        <Heading size="h3">Buttons</Heading>
        <div className="flex flex-wrap gap-4 border p-4 rounded-lg bg-white items-center">
          <Button>Default (Primary)</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="accent">Accent (Gold)</Button>
          <Button variant="outline">Outline</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="destructive">Destructive</Button>
          <Button variant="link">Link Button</Button>
          <Button disabled>Disabled</Button>
          <Button loading>Loading</Button>
          <Button size="sm">Small</Button>
          <Button size="lg">Large</Button>
          <Button size="icon"><Home className="h-4 w-4" /></Button>
          <Button icon={<Mail className="h-4 w-4" />}>With Icon</Button>
        </div>
        <div className="flex flex-wrap gap-4 border p-4 rounded-lg bg-[#000A0D] items-center">
           <Text className="text-white">Dark Background:</Text>
           <Button variant="default">Default</Button>
           <Button variant="outline">Outline (Dark)</Button>
           <Button variant="accent">Accent</Button>
        </div>
      </section>

      <section className="space-y-4">
        <Heading size="h3">Inputs & Selects</Heading>
        <div className="grid gap-4 max-w-md border p-4 rounded-lg bg-white">
          <Input placeholder="Default Input" />
          <Input placeholder="Error Input" error />
          <Input placeholder="Disabled Input" disabled />
          <div className="relative">
            <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
            <Input className="pl-9" placeholder="Input with Icon" />
          </div>
          
          <Select>
            <option>Select Option</option>
            <option>Option 1</option>
            <option>Option 2</option>
          </Select>
          <Select error>
            <option>Error Select</option>
          </Select>
        </div>
      </section>

      <section className="space-y-4">
        <Heading size="h3">Badges</Heading>
        <div className="flex gap-2 border p-4 rounded-lg bg-white">
          <Badge>Default</Badge>
          <Badge variant="secondary">Secondary</Badge>
          <Badge variant="outline">Outline</Badge>
          <Badge variant="destructive">Destructive</Badge>
          <Badge variant="accent">Accent</Badge>
        </div>
      </section>

      <section className="space-y-4">
        <Heading size="h3">Cards</Heading>
        <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <CardHeader>
              <CardTitle>Card Title</CardTitle>
              <CardDescription>Card Description goes here.</CardDescription>
            </CardHeader>
            <CardContent>
              <Text>Content of the card.</Text>
            </CardContent>
            <CardFooter>
              <Button className="w-full">Action</Button>
            </CardFooter>
          </Card>
        </div>
      </section>
    </div>
  )
}
